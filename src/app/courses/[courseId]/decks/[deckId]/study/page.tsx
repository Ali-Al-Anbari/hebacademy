import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { startStudy } from "./actions";
import { StudyView } from "./study-view";
import { StartStudyButton } from "./start-button";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default async function StudyPage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]/decks/[deckId]/study">) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");

  const { courseId, deckId } = await params;
  if (!validId(courseId) || !validId(deckId)) notFound();
  const userId = auth.claims.sub;
  const query = await searchParams;
  const sessionId = typeof query.session === "string" ? query.session : null;
  if (sessionId && !validId(sessionId)) notFound();

  const { data: course, error: courseError } = await supabase
    .from("courses").select("id, name")
    .eq("id", courseId).eq("user_id", userId).maybeSingle();
  if (courseError) console.error("Failed to load study course:", courseError);
  if (!courseError && !course) notFound();

  const deckResult = course && !courseError
    ? await supabase.from("decks").select("id, name")
        .eq("id", deckId).eq("course_id", courseId).eq("user_id", userId).maybeSingle()
    : null;
  if (deckResult?.error) console.error("Failed to load study deck:", deckResult.error);
  if (deckResult && !deckResult.error && !deckResult.data) notFound();

  const cardsResult = deckResult?.data
    ? await supabase.from("cards")
        .select("id, prompt, answer, prompt_image_path, answer_image_path")
        .eq("deck_id", deckId).eq("user_id", userId)
        .order("position", { ascending: true }).order("id", { ascending: true })
    : null;
  if (cardsResult?.error) console.error("Failed to load study cards:", cardsResult.error);

  const sessionResult = sessionId && deckResult?.data
    ? await supabase.from("study_sessions")
        .select("id, completed_at")
        .eq("id", sessionId).eq("deck_id", deckId).eq("user_id", userId)
        .eq("mode", "flashcards").maybeSingle()
    : null;
  if (sessionResult?.error) console.error("Failed to load study session:", sessionResult.error);
  if (sessionResult && !sessionResult.error && !sessionResult.data) notFound();

  const reviewsResult = sessionResult?.data
    ? await supabase.from("card_reviews").select("card_id, rating")
        .eq("study_session_id", sessionId).eq("user_id", userId)
    : null;
  if (reviewsResult?.error) console.error("Failed to load study reviews:", reviewsResult.error);

  const hasError = courseError || deckResult?.error || cardsResult?.error || sessionResult?.error || reviewsResult?.error;
  const cards = hasError ? [] : await Promise.all((cardsResult?.data ?? []).map(async (card) => {
    async function imageUrl(path: string | null) {
      if (!path) return null;
      const { data, error } = await supabase.storage.from("card-images").createSignedUrl(path, 3600);
      if (error) console.error("Failed to create study image URL:", error);
      return data?.signedUrl ?? null;
    }
    const [promptImageUrl, answerImageUrl] = await Promise.all([
      imageUrl(card.prompt_image_path), imageUrl(card.answer_image_path),
    ]);
    return {
      id: card.id,
      prompt: card.prompt,
      answer: card.answer,
      promptImageUrl,
      answerImageUrl,
    };
  }));

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <nav aria-label="Breadcrumb">
        <Link href={`/courses/${courseId}/decks/${deckId}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg pr-3 text-sm font-medium text-teal-700 hover:text-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">← Back to Deck</Link>
      </nav>
      <div className="mt-9 border-b border-slate-200 pb-8">
        <p className="text-sm font-medium text-teal-700">{course?.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Study {deckResult?.data?.name}</h1>
      </div>

      {hasError ? (
        <p role="alert" className="mt-8 rounded-xl border border-red-200 bg-white p-6 text-red-700">Could not load this study session. Please refresh and try again.</p>
      ) : sessionId && sessionResult?.data ? (
        <StudyView
          courseId={courseId}
          deckId={deckId}
          sessionId={sessionId}
          cards={cards}
          reviews={reviewsResult?.data ?? []}
          completed={Boolean(sessionResult.data.completed_at)}
        />
      ) : cards.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">This deck has no cards yet. Add cards before starting a study session.</p>
      ) : (
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-slate-600">Ready to study {cards.length} {cards.length === 1 ? "card" : "cards"}?</p>
          {query.error === "start" && <p role="alert" className="mt-3 text-sm text-red-700">Could not start a session. Please try again.</p>}
          <form action={startStudy.bind(null, courseId, deckId)} className="mt-5">
            <StartStudyButton />
          </form>
        </div>
      )}
    </main>
  );
}
