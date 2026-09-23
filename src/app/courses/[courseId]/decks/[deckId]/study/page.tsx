import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { getOwnedStudyCards, getSessionRatings } from "@/lib/study-data";
import { resolveSessionCards } from "@/lib/study-filter";
import { startStudy } from "./actions";
import { StudyView } from "./study-view";
import { StartStudyButton } from "./start-button";
import { AppBreadcrumb } from "@/components/app-breadcrumb";

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

  const sessionResult = sessionId && deckResult?.data
    ? await supabase.from("study_sessions")
        .select("id, completed_at, selected_card_ids, study_schedule_date_id")
        .eq("id", sessionId).eq("deck_id", deckId).eq("user_id", userId)
        .eq("mode", "flashcards").maybeSingle()
    : null;
  if (sessionResult?.error) console.error("Failed to load study session:", sessionResult.error);
  if (sessionResult && !sessionResult.error && !sessionResult.data) notFound();

  let returnScheduleId: string | null = null;
  if (sessionResult?.data) {
    const dateId = sessionResult.data.study_schedule_date_id;
    let scheduleId: string | null = null;
    if (dateId) {
      const { data: date, error } = await supabase.from("study_schedule_dates")
        .select("study_schedule_id").eq("id", dateId).maybeSingle();
      if (error) console.error("Failed to load scheduled study destination:", error);
      scheduleId = date?.study_schedule_id ?? null;
    } else if (typeof query.schedule === "string" && validId(query.schedule)) {
      scheduleId = query.schedule;
    }
    if (scheduleId) {
      const { data: schedule, error } = await supabase.from("study_schedules")
        .select("id").eq("id", scheduleId).eq("deck_id", deckId)
        .eq("user_id", userId).maybeSingle();
      if (error) console.error("Failed to verify scheduled study destination:", error);
      returnScheduleId = schedule?.id ?? null;
    }
  }

  let allCards: Awaited<ReturnType<typeof getOwnedStudyCards>> = [];
  let sessionRatings = new Map<string, string>();
  let loadError = false;
  if (deckResult?.data) {
    try {
      [allCards, sessionRatings] = await Promise.all([
        getOwnedStudyCards(supabase, deckId, userId),
        sessionResult?.data ? getSessionRatings(supabase, sessionId!, userId) : Promise.resolve(new Map<string, string>()),
      ]);
    } catch (error) {
      console.error("Failed to load study cards or reviews:", error);
      loadError = true;
    }
  }

  const selectedIds = sessionResult?.data?.selected_card_ids as string[] | null | undefined;
  const selectedCards = resolveSessionCards(allCards, selectedIds ?? null);
  const invalidSelection = selectedCards === null;
  const hasError = courseError || deckResult?.error || sessionResult?.error || loadError || invalidSelection;
  const cards = hasError || !selectedCards ? [] : await Promise.all(selectedCards.map(async (card) => {
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
  const selectedSet = new Set(cards.map((card) => card.id));
  const reviews = [...sessionRatings].filter(([cardId]) => selectedSet.has(cardId))
    .map(([card_id, rating]) => ({ card_id, rating }));

  return (
    <main className="page-container page-container--narrow">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" }, { label: course?.name ?? "Course", href: `/courses/${courseId}` }, { label: deckResult?.data?.name ?? "Deck", href: `/courses/${courseId}/decks/${deckId}` }]} current="Study" />
      <div className="page-intro mt-2">
        <p className="page-eyebrow">{course?.name} · Flashcards</p>
        <h1 className="page-title">Study {deckResult?.data?.name}</h1>
      </div>

      {hasError ? (
        <div className="mt-8"><p role="alert" className="notice-error">{invalidSelection && sessionId
          ? "A card in this session is no longer available. This session cannot be completed; start a new session with the remaining cards."
          : "Could not load this study session. Please refresh and try again."}</p>{invalidSelection && sessionId && <Link href={returnScheduleId ? `/study-schedules/${returnScheduleId}` : `/courses/${courseId}/decks/${deckId}`} className={buttonVariants({ variant: "secondary", className: "mt-4" })}>Back to {returnScheduleId ? "Schedule" : "Deck"}</Link>}</div>
      ) : sessionId && sessionResult?.data ? (
        <StudyView
          courseId={courseId}
          deckId={deckId}
          sessionId={sessionId}
          cards={cards}
          reviews={reviews}
          completed={Boolean(sessionResult.data.completed_at)}
          returnScheduleId={returnScheduleId}
        />
      ) : query.error === "empty" ? (
        <div className="empty-panel mt-8"><h2 className="empty-panel__title">No cards in that group yet.</h2><p className="empty-panel__copy">Choose another study group from the deck.</p></div>
      ) : cards.length === 0 ? (
        <div className="empty-panel mt-8"><h2 className="empty-panel__title">Nothing to study yet.</h2><p className="empty-panel__copy">This deck has no cards yet. Add cards before starting a study session.</p></div>
      ) : (
        <div className="surface-panel mt-8">
          <p className="page-eyebrow">Ready when you are</p>
          <p className="mt-3 text-lg text-ink">Study {cards.length} {cards.length === 1 ? "card" : "cards"} at your own pace.</p>
          {query.error === "start" && <p role="alert" className="notice-error mt-3 text-sm">Could not start a session. Please try again.</p>}
          <form action={startStudy.bind(null, courseId, deckId)} className="mt-5">
            <StartStudyButton />
          </form>
        </div>
      )}
    </main>
  );
}
