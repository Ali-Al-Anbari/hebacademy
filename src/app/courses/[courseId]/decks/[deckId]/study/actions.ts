"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Rating = "review_again" | "needs_practice" | "mastered";
const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const studyPath = (courseId: string, deckId: string) =>
  `/courses/${courseId}/decks/${deckId}/study`;

async function ownedStudy(courseId: string, deckId: string, sessionId?: string) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;
  if (!validId(courseId) || !validId(deckId) || (sessionId && !validId(sessionId))) return null;

  const { data: course, error: courseError } = await supabase
    .from("courses").select("id")
    .eq("id", courseId).eq("user_id", userId).maybeSingle();
  if (courseError) console.error("Failed to verify study course:", courseError);
  if (courseError || !course) return null;

  const { data: deck, error: deckError } = await supabase
    .from("decks").select("id")
    .eq("id", deckId).eq("course_id", courseId).eq("user_id", userId).maybeSingle();
  if (deckError) console.error("Failed to verify study deck:", deckError);
  if (deckError || !deck) return null;

  if (sessionId) {
    const { data: session, error: sessionError } = await supabase
      .from("study_sessions").select("id, completed_at")
      .eq("id", sessionId).eq("deck_id", deckId).eq("user_id", userId)
      .eq("mode", "flashcards").maybeSingle();
    if (sessionError) console.error("Failed to verify study session:", sessionError);
    if (sessionError || !session) return null;
    return { supabase, userId, session };
  }
  return { supabase, userId };
}

export async function startStudy(courseId: string, deckId: string) {
  const path = studyPath(courseId, deckId);
  const context = await ownedStudy(courseId, deckId);
  if (!context) redirect(`${path}?error=start`);

  const { count, error: countError } = await context.supabase
    .from("cards").select("id", { count: "exact", head: true })
    .eq("deck_id", deckId).eq("user_id", context.userId);
  if (countError) {
    console.error("Failed to count cards before study:", countError);
    redirect(`${path}?error=start`);
  }
  if (!count) redirect(path);

  const { data, error } = await context.supabase
    .from("study_sessions")
    .insert({ user_id: context.userId, deck_id: deckId, mode: "flashcards" })
    .select("id").single();
  if (error) {
    console.error("Failed to start study session:", error);
    redirect(`${path}?error=start`);
  }
  redirect(`${path}?session=${data.id}`);
}

async function progress(
  context: NonNullable<Awaited<ReturnType<typeof ownedStudy>>>,
  deckId: string,
  sessionId: string,
) {
  const [cardsResult, reviewsResult] = await Promise.all([
    context.supabase.from("cards").select("id")
      .eq("deck_id", deckId).eq("user_id", context.userId),
    context.supabase.from("card_reviews").select("card_id, rating")
      .eq("study_session_id", sessionId).eq("user_id", context.userId),
  ]);
  if (cardsResult.error || reviewsResult.error) {
    console.error("Failed to count study progress:", cardsResult.error ?? reviewsResult.error);
    return null;
  }
  const reviewed = new Set((reviewsResult.data ?? []).map((review) => review.card_id));
  const complete = (cardsResult.data ?? []).every((card) => reviewed.has(card.id));
  const counts = { review_again: 0, needs_practice: 0, mastered: 0 };
  for (const review of reviewsResult.data ?? []) {
    if (review.rating in counts) counts[review.rating as Rating] += 1;
  }
  return { complete, counts };
}

async function completeSession(
  context: NonNullable<Awaited<ReturnType<typeof ownedStudy>>>,
  deckId: string,
  sessionId: string,
) {
  const state = await progress(context, deckId, sessionId);
  if (!state) return null;
  if (state.complete && !context.session?.completed_at) {
    const { error } = await context.supabase.from("study_sessions")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", sessionId).eq("deck_id", deckId).eq("user_id", context.userId)
      .is("completed_at", null);
    if (error) {
      console.error("Failed to complete study session:", error);
      return null;
    }
  }
  return state;
}

export async function rateCard(
  courseId: string, deckId: string, sessionId: string, cardId: string, rating: Rating,
) {
  if (!validId(cardId) || !["review_again", "needs_practice", "mastered"].includes(rating)) {
    return { error: "Could not save this rating. Please try again.", state: null };
  }
  const context = await ownedStudy(courseId, deckId, sessionId);
  if (!context || !context.session) {
    return { error: "This study session is no longer active.", state: null };
  }
  if (context.session.completed_at) {
    const { data: previous } = await context.supabase.from("card_reviews").select("id")
      .eq("study_session_id", sessionId).eq("card_id", cardId)
      .eq("user_id", context.userId).limit(1).maybeSingle();
    const state = previous ? await progress(context, deckId, sessionId) : null;
    return state
      ? { error: null, state: { ...state, complete: true } }
      : { error: "This study session is no longer active.", state: null };
  }

  const { data: card, error: cardError } = await context.supabase
    .from("cards").select("id")
    .eq("id", cardId).eq("deck_id", deckId).eq("user_id", context.userId).maybeSingle();
  if (cardError) console.error("Failed to verify reviewed card:", cardError);
  if (cardError || !card) return { error: "Could not save this rating. Please try again.", state: null };

  const { data: previous, error: previousError } = await context.supabase
    .from("card_reviews").select("id")
    .eq("study_session_id", sessionId).eq("card_id", cardId)
    .eq("user_id", context.userId).limit(1).maybeSingle();
  if (previousError) {
    console.error("Failed to check prior card review:", previousError);
    return { error: "Could not save this rating. Please try again.", state: null };
  }
  if (!previous) {
    const { error } = await context.supabase.from("card_reviews").insert({
      user_id: context.userId,
      card_id: cardId,
      study_session_id: sessionId,
      rating,
    });
    if (error) {
      console.error("Failed to save card review:", error);
      return { error: "Could not save this rating. Please try again.", state: null };
    }
  }

  const state = await completeSession(context, deckId, sessionId);
  if (!state) return { error: "The rating was saved, but progress could not update. Try again.", state: null };
  return { error: null, state };
}

export async function finishStudy(courseId: string, deckId: string, sessionId: string) {
  const context = await ownedStudy(courseId, deckId, sessionId);
  if (!context || !context.session) return { error: "This study session is unavailable.", state: null };
  const state = await completeSession(context, deckId, sessionId);
  if (!state) return { error: "Could not complete the session. Please try again.", state: null };
  if (!state.complete) return { error: "Some cards still need a rating.", state };
  return { error: null, state };
}
