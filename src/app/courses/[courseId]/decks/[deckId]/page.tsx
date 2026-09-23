import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CardManager } from "./card-manager";
import { DeckProgress, getDeckProgress } from "./progress";
import { startStudy } from "./study/actions";
import { StartStudyButton } from "./study/start-button";
import { Button } from "@/components/ui/button";
import { ListChecks } from "lucide-react";
import { AppBreadcrumb } from "@/components/app-breadcrumb";

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
    <main className="page-container">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" }, { label: course?.name ?? "Course", href: `/courses/${courseId}` }]} current={deck?.name ?? "Deck"} />
      {courseError || deckResult?.error || cardResult?.error ? (
        <p role="alert" className="notice-error mt-9">Could not load this deck. Please refresh and try again.</p>
      ) : (
        <>
          <header className="mt-3"><h1 className="page-title">{deck?.name}</h1><p className="mt-2 text-sm text-muted-foreground">{cards.length} {cards.length === 1 ? "card" : "cards"}</p>{deck?.description && <p className="page-description whitespace-pre-wrap">{deck.description}</p>}</header>
          <nav aria-label="Study modes" className="mt-6 flex flex-col gap-2 sm:flex-row"><form action={startStudy.bind(null, courseId, deckId)}><StartStudyButton /></form><Button render={<Link href={`/courses/${courseId}/decks/${deckId}/quiz`} />} variant="outline" size="lg" className="w-full sm:w-auto"><ListChecks /> Quiz</Button></nav>
          {progress ? <DeckProgress summary={progress} /> : (
            <p role="alert" className="notice-error mt-8">Could not load study progress. Please refresh and try again.</p>
          )}
          <CardManager courseId={courseId} deckId={deckId} userId={userId} cards={cards} />
        </>
      )}
    </main>
  );
}
