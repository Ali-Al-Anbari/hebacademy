"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readAnswers, readQuestions, type QuizProgress, type QuizQuestion } from "@/lib/quiz-session";
import { createClient } from "@/lib/supabase/server";

const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const answerKey = (answer: string) => answer.trim().toLowerCase();
const quizPath = (courseId: string, deckId: string) => `/courses/${courseId}/decks/${deckId}/quiz`;

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

async function ownedQuiz(courseId: string, deckId: string, sessionId?: string) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;
  if (!validId(courseId) || !validId(deckId) || (sessionId && !validId(sessionId))) return null;
  const { data: course, error: courseError } = await supabase.from("courses")
    .select("id").eq("id", courseId).eq("user_id", userId).maybeSingle();
  if (courseError || !course) return null;
  const { data: deck, error: deckError } = await supabase.from("decks")
    .select("id").eq("id", deckId).eq("course_id", courseId).eq("user_id", userId).maybeSingle();
  if (deckError || !deck) return null;
  if (!sessionId) return { supabase, userId };
  const { data: session, error } = await supabase.from("quiz_sessions")
    .select("id, questions, answers, current_index, revision, completed_at")
    .eq("id", sessionId).eq("deck_id", deckId).eq("user_id", userId).maybeSingle();
  if (error || !session) return null;
  return { supabase, userId, session };
}

export async function startQuiz(courseId: string, deckId: string) {
  const path = quizPath(courseId, deckId);
  const context = await ownedQuiz(courseId, deckId);
  if (!context) redirect(`${path}?error=start`);
  const cards: { id: string; prompt: string; answer: string; prompt_image_path: string | null }[] = [];
  try {
    for (let offset = 0; ;) {
      const { data, count, error } = await context.supabase.from("cards")
        .select("id, prompt, answer, prompt_image_path", { count: "exact" })
        .eq("deck_id", deckId).eq("user_id", context.userId)
        .order("position").order("id").range(offset, offset + 999);
      if (error || count === null) throw error ?? new Error("Missing quiz card count");
      cards.push(...(data ?? []));
      if (offset + (data?.length ?? 0) >= count) break;
      if (!data?.length) throw new Error("Quiz card query stopped early");
      offset += data.length;
    }
  } catch (error) {
    console.error("Failed to load quiz cards:", error);
    redirect(`${path}?error=start`);
  }
  const distinctAnswers = new Map<string, string>();
  for (const card of cards) {
    const key = answerKey(card.answer);
    if (!key) redirect(`${path}?error=answers`);
    if (!distinctAnswers.has(key)) distinctAnswers.set(key, card.answer.trim());
  }
  if (cards.length < 2 || distinctAnswers.size < 2) redirect(`${path}?error=empty`);
  const questions: QuizQuestion[] = shuffle(cards).map((card) => {
    const correctKey = answerKey(card.answer);
    const distractors = shuffle([...distinctAnswers.entries()].filter(([key]) => key !== correctKey)).slice(0, 3);
    return {
      id: card.id, prompt: card.prompt, promptImagePath: card.prompt_image_path,
      correctKey, correctAnswer: card.answer.trim(),
      options: shuffle([{ key: correctKey, label: card.answer.trim() },
        ...distractors.map(([key, label]) => ({ key, label }))]),
    };
  });
  const { data: session, error } = await context.supabase.from("quiz_sessions")
    .insert({ user_id: context.userId, deck_id: deckId, questions })
    .select("id").single();
  if (error || !session) {
    if (error) console.error("Failed to start quiz:", error);
    redirect(`${path}?error=start`);
  }
  revalidatePath(`/courses/${courseId}/decks/${deckId}`);
  redirect(`${path}?session=${session.id}`);
}

type QuizResult = { error: string | null; progress: QuizProgress | null; conflict: boolean };
const failed = (error: string, conflict = false): QuizResult => ({ error, progress: null, conflict });

async function changeQuiz(courseId: string, deckId: string, sessionId: string,
  revision: number, optionKey: string | null): Promise<QuizResult> {
  if (!Number.isSafeInteger(revision) || revision < 0 || typeof sessionId !== "string") {
    return failed("This quiz could not be updated.");
  }
  const context = await ownedQuiz(courseId, deckId, sessionId);
  if (!context || !context.session) return failed("This quiz is unavailable.");
  const { session } = context;
  const questions = readQuestions(session.questions);
  const answers = questions && readAnswers(session.answers, questions);
  if (!questions || !answers || !Number.isInteger(session.current_index)) {
    return failed("This quiz could not be loaded.");
  }
  if (session.revision !== revision) return failed("This quiz changed in another tab. Refresh to see saved progress.", true);
  if (session.completed_at) return failed("This quiz is already complete. Refresh to see the results.", true);
  const index = session.current_index;
  if (index < 0 || index >= questions.length) return failed("This quiz could not be updated.");
  let nextAnswers = answers;
  let nextIndex = index;
  let completedAt: string | null = null;
  if (optionKey !== null) {
    if (typeof optionKey !== "string" || !questions[index].options.some((option) => option.key === optionKey)) {
      return failed("Choose one of the available answers.");
    }
    if (answers.length !== index) return failed("This question already has a saved answer. Refresh to continue.", true);
    nextAnswers = [...answers, optionKey];
  } else {
    if (answers.length !== index + 1) return failed("Answer this question before continuing.");
    nextIndex = index + 1;
    if (nextIndex === questions.length) completedAt = new Date().toISOString();
  }
  const { data: saved, error } = await context.supabase.from("quiz_sessions")
    .update({ answers: nextAnswers, current_index: nextIndex, revision: revision + 1,
      ...(completedAt ? { completed_at: completedAt } : {}) })
    .eq("id", sessionId).eq("user_id", context.userId).eq("deck_id", deckId)
    .eq("revision", revision).is("completed_at", null)
    .select("answers, current_index, revision, completed_at").maybeSingle();
  if (error) {
    console.error("Failed to save quiz progress:", error);
    return failed("Could not save quiz progress. Please try again.");
  }
  if (!saved) return failed("This quiz changed in another tab. Refresh to see saved progress.", true);
  if (completedAt) revalidatePath(`/courses/${courseId}/decks/${deckId}`);
  return { error: null, progress: saved as QuizProgress, conflict: false };
}

export async function submitQuizAnswer(courseId: string, deckId: string,
  sessionId: string, revision: number, optionKey: string) {
  return changeQuiz(courseId, deckId, sessionId, revision, optionKey);
}

export async function nextQuizQuestion(courseId: string, deckId: string,
  sessionId: string, revision: number) {
  return changeQuiz(courseId, deckId, sessionId, revision, null);
}
