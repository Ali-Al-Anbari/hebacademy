import { randomInt } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuizView, type QuizQuestion } from "./quiz-view";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const answerKey = (answer: string) => answer.trim().toLowerCase();

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

export default async function QuizPage({
  params,
}: PageProps<"/courses/[courseId]/decks/[deckId]/quiz">) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");

  const { courseId, deckId } = await params;
  if (!validId(courseId) || !validId(deckId)) notFound();
  const userId = auth.claims.sub;
  const deckUrl = `/courses/${courseId}/decks/${deckId}`;

  const { data: course, error: courseError } = await supabase
    .from("courses").select("id, name")
    .eq("id", courseId).eq("user_id", userId).maybeSingle();
  if (courseError) console.error("Failed to load quiz course:", courseError);
  if (!courseError && !course) notFound();

  const deckResult = course && !courseError
    ? await supabase.from("decks").select("id, name")
        .eq("id", deckId).eq("course_id", courseId).eq("user_id", userId).maybeSingle()
    : null;
  if (deckResult?.error) console.error("Failed to load quiz deck:", deckResult.error);
  if (deckResult && !deckResult.error && !deckResult.data) notFound();

  // Page through cards so a deck with more than Supabase's default row limit
  // still includes every card in the quiz.
  const cards: { id: string; prompt: string; answer: string; prompt_image_path: string | null }[] = [];
  let cardsError = null;
  if (deckResult?.data) {
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const result = await supabase.from("cards")
        .select("id, prompt, answer, prompt_image_path")
        .eq("deck_id", deckId).eq("user_id", userId)
        .order("position", { ascending: true }).order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (result.error) {
        cardsError = result.error;
        console.error("Failed to load quiz cards:", result.error);
        break;
      }
      cards.push(...(result.data ?? []));
      if (!result.data || result.data.length < pageSize) break;
    }
  }

  const distinctAnswers = new Map<string, string>();
  const hasBlankAnswer = cards.some((card) => !card.answer.trim());
  for (const card of cards) {
    const key = answerKey(card.answer);
    if (key && !distinctAnswers.has(key)) distinctAnswers.set(key, card.answer.trim());
  }

  let questions: QuizQuestion[] = [];
  if (!cardsError && !hasBlankAnswer && distinctAnswers.size >= 2) {
    questions = await Promise.all(shuffle(cards).map(async (card) => {
      const correctKey = answerKey(card.answer);
      const distractors = shuffle([...distinctAnswers.entries()]
        .filter(([key]) => key !== correctKey))
        .slice(0, 3);
      const options = shuffle([
        { key: correctKey, label: card.answer.trim() },
        ...distractors.map(([key, label]) => ({ key, label })),
      ]);
      let promptImageUrl: string | null = null;
      if (card.prompt_image_path) {
        const { data, error } = await supabase.storage.from("card-images")
          .createSignedUrl(card.prompt_image_path, 3600);
        if (error) console.error("Failed to create quiz prompt image URL:", error);
        promptImageUrl = data?.signedUrl ?? null;
      }
      return {
        id: card.id,
        prompt: card.prompt,
        promptImageUrl,
        correctKey,
        correctAnswer: card.answer.trim(),
        options,
      };
    }));
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <nav aria-label="Breadcrumb">
        <Link href={deckUrl} className="inline-flex min-h-11 items-center gap-2 rounded-lg pr-3 text-sm font-medium text-teal-700 hover:text-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">← Back to Deck</Link>
      </nav>
      <div className="mt-9 border-b border-slate-200 pb-8">
        <p className="text-sm font-medium text-teal-700">{course?.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Quiz: {deckResult?.data?.name}</h1>
      </div>
      {courseError || deckResult?.error || cardsError ? (
        <p role="alert" className="mt-8 rounded-xl border border-red-200 bg-white p-6 text-red-700">Could not load this quiz. Please refresh and try again.</p>
      ) : cards.length < 2 ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">Add at least two cards to this deck before starting a quiz.</p>
      ) : hasBlankAnswer ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">Every card needs an answer before this deck can be quizzed.</p>
      ) : distinctAnswers.size < 2 ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">This deck needs at least two different answers for a multiple-choice quiz.</p>
      ) : (
        <QuizView questions={questions} deckUrl={deckUrl} />
      )}
    </main>
  );
}
