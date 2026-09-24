import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CardManager } from "./card-manager";
import { DeckProgress, getDeckProgress } from "./progress";
import { startStudy } from "./study/actions";
import { StartStudyButton } from "./study/start-button";
import { StudySelection } from "./study/selection";
import { buttonVariants } from "@/components/ui/button";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { readAnswers, readQuestions } from "@/lib/quiz-session";
import type { StudyFilter } from "@/lib/study-filter";
import { getOwnedStudyCards } from "@/lib/study-data";

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
  let starredCount: number | null = null;
  if (cardResult && !cardResult.error) {
    try {
      progress = await getDeckProgress(supabase, deckId, userId, cardResult.count ?? 0);
    } catch (error) {
      console.error("Failed to load deck progress:", error);
    }
  }
  if (deck) {
    const { count, error } = await supabase.from("cards")
      .select("id", { count: "exact", head: true })
      .eq("deck_id", deckId).eq("user_id", userId).eq("is_starred", true);
    if (error) console.error("Failed to count starred study cards:", error);
    else starredCount = count ?? 0;
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

  const resumeStudy: Partial<Record<StudyFilter, string>> = {};
  let legacyResume: string | null = null;
  let latestResume: string | null = null;
  let latestResumeLabel = "Resume previous study";
  let resumeQuiz: string | null = null;
  if (deck) {
    try {
      const ownedCardIds = new Set((cardResult?.count ?? 0) > cards.length
        ? (await getOwnedStudyCards(supabase, deckId, userId)).map((card) => card.id)
        : cards.map((card) => card.id));
      for (let offset = 0; ;) {
        const { data, count, error } = await supabase.from("study_sessions")
          .select("id, study_filter, selected_card_ids", { count: "exact" })
          .eq("user_id", userId).eq("deck_id", deckId).eq("mode", "flashcards")
          .is("completed_at", null).is("study_schedule_date_id", null)
          .is("study_schedule_id", null)
          .order("started_at", { ascending: false }).order("id", { ascending: false })
          .range(offset, offset + 999);
        if (error || count === null) throw error ?? new Error("Missing study session count");
        for (const session of data ?? []) {
          const filter = session.study_filter as StudyFilter | null;
          const ids = session.selected_card_ids as string[] | null;
          const valid = ids === null || (ids.length > 0 && new Set(ids).size === ids.length
            && ids.every((id) => ownedCardIds.has(id)));
          if (!valid) continue;
          const url = `/courses/${courseId}/decks/${deckId}/study?session=${session.id}`;
          if (!latestResume) {
            latestResume = url;
            latestResumeLabel = filter ? `Resume ${{
              all: "All Cards", starred: "Starred", review_again: "Review Again",
              needs_practice: "Needs Practice", not_studied: "Not Studied",
            }[filter]}` : "Resume previous study";
          }
          if (filter && !resumeStudy[filter]) resumeStudy[filter] = url;
          else if (!filter && !legacyResume) legacyResume = url;
        }
        if ((Object.keys(resumeStudy).length === 5 && legacyResume) || offset + (data?.length ?? 0) >= count) break;
        if (!data?.length) break;
        offset += data.length;
      }
      for (let offset = 0; !resumeQuiz;) {
        const { data, count, error } = await supabase.from("quiz_sessions")
          .select("id, questions, answers", { count: "exact" })
          .eq("user_id", userId).eq("deck_id", deckId).is("completed_at", null)
          .order("started_at", { ascending: false }).order("id", { ascending: false })
          .range(offset, offset + 99);
        if (error || count === null) throw error ?? new Error("Missing quiz session count");
        const valid = (data ?? []).find((session) => {
          const questions = readQuestions(session.questions);
          return questions && readAnswers(session.answers, questions);
        });
        if (valid) resumeQuiz = `/courses/${courseId}/decks/${deckId}/quiz?session=${valid.id}`;
        if (offset + (data?.length ?? 0) >= count || !data?.length) break;
        offset += data.length;
      }
    } catch (error) {
      console.error("Failed to load resumable sessions:", error);
    }
  }

  return (
    <main className="page-container">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" }, { label: course?.name ?? "Course", href: `/courses/${courseId}` }]} current={deck?.name ?? "Deck"} />
      {courseError || deckResult?.error || cardResult?.error ? (
        <p role="alert" className="notice-error mt-9">Could not load this deck. Please refresh and try again.</p>
      ) : (
        <>
          <header className="mt-3"><h1 className="page-title">{deck?.name}</h1><p className="mt-2 text-sm font-medium text-muted-foreground">{cards.length} {cards.length === 1 ? "card" : "cards"}</p>{deck?.description && <p className="page-description whitespace-pre-wrap">{deck.description}</p>}</header>
          <section className="study-entry mt-7" aria-labelledby="study-entry-heading">
            <h2 id="study-entry-heading" className="font-heading text-xl font-semibold">Study this deck</h2>
            <p className="mt-1 text-sm text-foreground/75">Practice with flashcards or test your recall in a quiz.</p>
            <nav aria-label="Study modes" className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{progress && starredCount !== null ? <StudySelection courseId={courseId} deckId={deckId} resumes={resumeStudy} counts={{ all: progress.totalCards, starred: starredCount, review_again: progress.reviewAgain, needs_practice: progress.needsPractice, not_studied: progress.notStudied }} /> : <form action={startStudy.bind(null, courseId, deckId)}><StartStudyButton label="Study Flashcards" /></form>}<Link href={`/courses/${courseId}/decks/${deckId}/quiz`} className={buttonVariants({ variant: "outline", size: "lg", className: "order-2 w-full sm:w-auto" })}>Quiz</Link></nav>
            {(latestResume || legacyResume || resumeQuiz) && <div className="study-entry__resumes mt-5 flex flex-col gap-2 pt-4 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-5">
              <span className="text-sm font-semibold">Continue studying</span>
              {latestResume && <Link href={latestResume} className="study-resume-link">{latestResumeLabel}</Link>}
              {legacyResume && legacyResume !== latestResume && <Link href={legacyResume} className="study-resume-link">Resume previous session</Link>}
              {resumeQuiz && <Link href={resumeQuiz} className="study-resume-link">Resume Quiz</Link>}
            </div>}
          </section>
          {progress ? <DeckProgress summary={progress} /> : (
            <p role="alert" className="notice-error mt-8">Could not load study progress. Please refresh and try again.</p>
          )}
          <CardManager courseId={courseId} deckId={deckId} userId={userId} cards={cards} />
        </>
      )}
    </main>
  );
}
