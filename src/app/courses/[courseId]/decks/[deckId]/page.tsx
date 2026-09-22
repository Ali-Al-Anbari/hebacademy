import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CardManager } from "./card-manager";
import { DeckProgress, getDeckProgress } from "./progress";
import { startStudy } from "./study/actions";
import { StartStudyButton } from "./study/start-button";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default async function DeckPage({
  params,
}: PageProps<"/courses/[courseId]/decks/[deckId]">) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  if (authError || !authData?.claims?.sub) redirect("/login");

  const { courseId, deckId } = await params;
  if (!validId(courseId) || !validId(deckId)) notFound();
  const userId = authData.claims.sub;

  const { data: course, error: courseError } = await supabase
    .from("courses").select("id, name")
    .eq("id", courseId).eq("user_id", userId).maybeSingle();
  if (courseError) console.error("Failed to load deck course:", courseError);
  if (!courseError && !course) notFound();

  const deckResult = course && !courseError
    ? await supabase.from("decks").select("id, name, description")
        .eq("id", deckId).eq("course_id", courseId).eq("user_id", userId).maybeSingle()
    : null;
  if (deckResult?.error) console.error("Failed to load deck:", deckResult.error);
  if (deckResult && !deckResult.error && !deckResult.data) notFound();

  const deck = deckResult?.data;
  const cardResult = deck
    ? await supabase.from("cards")
        .select("id, prompt, answer, prompt_image_path, answer_image_path, is_starred, position", { count: "exact" })
        .eq("deck_id", deckId).eq("user_id", userId)
        .order("position", { ascending: true }).order("id", { ascending: true })
    : null;
  if (cardResult?.error) console.error("Failed to load cards:", cardResult.error);

  let progress = null;
  if (cardResult && !cardResult.error) {
    try {
      progress = await getDeckProgress(supabase, deckId, userId, cardResult.count ?? 0);
    } catch (error) {
      console.error("Failed to load deck progress:", error);
    }
  }

  const cards = await Promise.all((cardResult?.data ?? []).map(async (card) => {
    async function imageUrl(path: string | null) {
      if (!path) return null;
      const { data, error } = await supabase.storage.from("card-images").createSignedUrl(path, 3600);
      if (error) console.error("Failed to create card image URL:", error);
      return data?.signedUrl ?? null;
    }
    const [promptImageUrl, answerImageUrl] = await Promise.all([
      imageUrl(card.prompt_image_path),
      imageUrl(card.answer_image_path),
    ]);
    return { ...card, prompt_image_url: promptImageUrl, answer_image_url: answerImageUrl };
  }));

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <Link href={`/courses/${courseId}`} className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-900 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">← Back to Course</Link>
      {courseError || deckResult?.error || cardResult?.error ? (
        <p role="alert" className="mt-9 rounded-xl border border-red-200 bg-white p-6 text-red-700">Could not load this deck. Please refresh and try again.</p>
      ) : (
        <>
          <div className="mt-9 border-b border-slate-200 pb-8">
            <p className="text-sm font-medium text-teal-700">{course?.name}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{deck?.name}</h1>
            {deck?.description && <p className="mt-3 whitespace-pre-wrap text-slate-600">{deck.description}</p>}
            <form action={startStudy.bind(null, courseId, deckId)} className="mt-6">
              <StartStudyButton />
            </form>
          </div>
          {progress ? <DeckProgress summary={progress} /> : (
            <p role="alert" className="mt-8 rounded-xl border border-red-200 bg-white p-6 text-red-700">Could not load study progress. Please refresh and try again.</p>
          )}
          <CardManager courseId={courseId} deckId={deckId} userId={userId} cards={cards} />
        </>
      )}
    </main>
  );
}
