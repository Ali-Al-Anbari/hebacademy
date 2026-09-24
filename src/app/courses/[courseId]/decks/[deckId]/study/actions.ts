"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLatestDeckRatings, getOwnedStudyCards, getSessionRatings } from "@/lib/study-data";
import { selectStudyCardIds, type StudyFilter } from "@/lib/study-filter";

type Rating = "review_again" | "needs_practice" | "mastered";
const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const deckPath = (courseId: string, deckId: string) =>
  `/courses/${courseId}/decks/${deckId}`;
const studyPath = (courseId: string, deckId: string) =>
  `${deckPath(courseId, deckId)}/study`;

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
      .from("study_sessions").select("id, completed_at, selected_card_ids, study_schedule_date_id, study_schedule_id")
      .eq("id", sessionId).eq("deck_id", deckId).eq("user_id", userId)
      .eq("mode", "flashcards").maybeSingle();
    if (sessionError) console.error("Failed to verify study session:", sessionError);
    if (sessionError || !session) return null;
    return { supabase, userId, session };
  }
  return { supabase, userId };
}

export async function startStudy(courseId: string, deckId: string, formData?: FormData) {
  const path = studyPath(courseId, deckId);
  const context = await ownedStudy(courseId, deckId);
  if (!context) redirect(`${path}?error=start`);

  const requestedFilter = formData instanceof FormData ? formData.get("filter") : null;
  const allowedFilters = ["all", "starred", "review_again", "needs_practice", "not_studied"];
  if (requestedFilter !== null && (typeof requestedFilter !== "string" || !allowedFilters.includes(requestedFilter))) {
    redirect(`${path}?error=start`);
  }
  const filter = (requestedFilter ?? "all") as StudyFilter;

  let selectedIds: string[];
  try {
    const cards = await getOwnedStudyCards(context.supabase, deckId, context.userId);
    const needsHistory = filter === "review_again" || filter === "needs_practice" || filter === "not_studied";
    const ratings = needsHistory
      ? (await getLatestDeckRatings(context.supabase, deckId, context.userId, cards.length)).ratings
      : new Map();
    selectedIds = selectStudyCardIds(cards, ratings, filter);
  } catch (error) {
    console.error("Failed to select study cards:", error);
    redirect(`${path}?error=start`);
  }
  if (!selectedIds.length) redirect(filter === "all" ? path : `${path}?error=empty`);

  const { data, error } = await context.supabase
    .from("study_sessions")
    .insert({
      user_id: context.userId,
      deck_id: deckId,
      mode: "flashcards",
      selected_card_ids: selectedIds,
      study_filter: filter,
    })
    .select("id").single();
  if (error) {
    console.error("Failed to start study session:", error);
    redirect(`${path}?error=start`);
  }
  revalidatePath(deckPath(courseId, deckId));
  redirect(`${path}?session=${data.id}`);
}

async function progress(
  context: NonNullable<Awaited<ReturnType<typeof ownedStudy>>>,
  deckId: string,
  sessionId: string,
) {
  try {
    const selectedCardIds = context.session?.selected_card_ids as string[] | null | undefined;
    const [cardIds, ratings] = await Promise.all([
      selectedCardIds !== null && selectedCardIds !== undefined
        ? Promise.resolve(selectedCardIds)
        : getOwnedStudyCards(context.supabase, deckId, context.userId).then((cards) => cards.map((card) => card.id)),
      getSessionRatings(context.supabase, sessionId, context.userId),
    ]);
    const complete = cardIds.every((id) => ratings.has(id));
    const counts = { review_again: 0, needs_practice: 0, mastered: 0 };
    for (const id of cardIds) {
      const rating = ratings.get(id);
      if (rating) counts[rating] += 1;
    }
    return { complete, counts };
  } catch (error) {
    console.error("Failed to count study progress:", error);
    return null;
  }
}

async function completeSession(
  context: NonNullable<Awaited<ReturnType<typeof ownedStudy>>>,
  deckId: string,
  sessionId: string,
) {
  const state = await progress(context, deckId, sessionId);
  if (!state) return null;
  if (state.complete && !context.session?.completed_at) {
    const { data, error } = await context.supabase.from("study_sessions")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", sessionId).eq("deck_id", deckId).eq("user_id", context.userId)
      .is("completed_at", null).select("id, completed_at").maybeSingle();
    if (error || !data) {
      const { data: latest, error: reloadError } = await context.supabase.from("study_sessions")
        .select("completed_at").eq("id", sessionId).eq("deck_id", deckId)
        .eq("user_id", context.userId).maybeSingle();
      if (reloadError || !latest?.completed_at) {
        console.error("Failed to complete study session:", error ?? reloadError ?? "No completed row");
        return null;
      }
    }
  }
  if (state.complete && context.session?.study_schedule_date_id) {
    const { data: date, error } = await context.supabase.from("study_schedule_dates")
      .select("study_schedule_id").eq("id", context.session.study_schedule_date_id).maybeSingle();
    if (error) console.error("Failed to refresh scheduled review:", error);
    if (date) {
      revalidatePath(`/study-schedules/${date.study_schedule_id}`);
      revalidatePath("/");
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
  const selectedCardIds = context.session.selected_card_ids as string[] | null;
  if (selectedCardIds && !selectedCardIds.includes(cardId)) {
    return { error: "This card is not in the selected study session.", state: null };
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
  revalidatePath(deckPath(courseId, deckId));
  if (!state) return { error: "The rating was saved, but progress could not update. Try again.", state: null };
  return { error: null, state };
}

export async function finishStudy(courseId: string, deckId: string, sessionId: string) {
  const context = await ownedStudy(courseId, deckId, sessionId);
  if (!context || !context.session) return { error: "This study session is unavailable.", state: null };
  const state = await completeSession(context, deckId, sessionId);
  if (!state) return { error: "Could not complete the session. Please try again.", state: null };
  if (!state.complete) return { error: "Some cards still need a rating.", state };
  revalidatePath(deckPath(courseId, deckId));
  return { error: null, state };
}
