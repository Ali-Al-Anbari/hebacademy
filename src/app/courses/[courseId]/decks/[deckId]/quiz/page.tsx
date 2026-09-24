import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { readAnswers, readQuestions } from "@/lib/quiz-session";
import { getOwnedStudyCards } from "@/lib/study-data";
import { createClient } from "@/lib/supabase/server";
import { startQuiz } from "./actions";
import { QuizView } from "./quiz-view";
import { StartQuizButton } from "./start-button";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default async function QuizPage({ params, searchParams }:
  PageProps<"/courses/[courseId]/decks/[deckId]/quiz">) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const { courseId, deckId } = await params;
  if (!validId(courseId) || !validId(deckId)) notFound();
  const query = await searchParams;
  const sessionId = typeof query.session === "string" ? query.session : null;
  if (sessionId && !validId(sessionId)) notFound();
  const userId = auth.claims.sub;
  const deckUrl = `/courses/${courseId}/decks/${deckId}`;

  const { data: course, error: courseError } = await supabase.from("courses")
    .select("id, name").eq("id", courseId).eq("user_id", userId).maybeSingle();
  if (courseError) console.error("Failed to load quiz course:", courseError);
  if (!courseError && !course) notFound();
  const deckResult = course && !courseError
    ? await supabase.from("decks").select("id, name")
        .eq("id", deckId).eq("course_id", courseId).eq("user_id", userId).maybeSingle()
    : null;
  if (deckResult?.error) console.error("Failed to load quiz deck:", deckResult.error);
  if (deckResult && !deckResult.error && !deckResult.data) notFound();

  const sessionResult = sessionId && deckResult?.data
    ? await supabase.from("quiz_sessions")
        .select("id, questions, answers, current_index, revision, completed_at")
        .eq("id", sessionId).eq("deck_id", deckId).eq("user_id", userId).maybeSingle()
    : null;
  if (sessionResult?.error) console.error("Failed to load quiz session:", sessionResult.error);
  if (sessionResult && !sessionResult.error && !sessionResult.data) notFound();

  const questions = sessionResult?.data ? readQuestions(sessionResult.data.questions) : null;
  const answers = questions ? readAnswers(sessionResult?.data?.answers, questions) : null;
  const invalidSession = Boolean(sessionResult?.data && (!questions || !answers));
  const displayQuestions = questions && !invalidSession
    ? await Promise.all(questions.map(async (question) => {
        let promptImageUrl: string | null = null;
        if (question.promptImagePath) {
          const { data, error } = await supabase.storage.from("card-images")
            .createSignedUrl(question.promptImagePath, 3600);
          if (error) console.error("Failed to sign quiz prompt image:", error);
          promptImageUrl = data?.signedUrl ?? null;
        }
        return { ...question, promptImageUrl };
      }))
    : [];

  let readyCards: Awaited<ReturnType<typeof getOwnedStudyCards>> = [];
  let cardsError = false;
  if (!sessionId && deckResult?.data) {
    try {
      readyCards = await getOwnedStudyCards(supabase, deckId, userId);
    } catch (error) {
      console.error("Failed to load quiz-ready cards:", error);
      cardsError = true;
    }
  }
  const hasBlankAnswer = readyCards.some((card) => !card.answer.trim());
  const distinctAnswers = new Set(readyCards.map((card) => card.answer.trim().toLowerCase()).filter(Boolean));
  const cannotStart = readyCards.length < 2 || hasBlankAnswer || distinctAnswers.size < 2;

  return (
    <main className="page-container page-container--narrow">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" },
        { label: course?.name ?? "Course", href: `/courses/${courseId}` },
        { label: deckResult?.data?.name ?? "Deck", href: deckUrl }]} current="Quiz" />
      <div className="page-intro mt-2"><p className="page-eyebrow">{course?.name} · Quiz</p><h1 className="page-title">Quiz: {deckResult?.data?.name}</h1></div>
      {courseError || deckResult?.error || sessionResult?.error || cardsError || invalidSession ? (
        <div className="mt-8"><p role="alert" className="notice-error">Could not load this quiz. Please refresh or return to the deck.</p><Link href={deckUrl} className={buttonVariants({ variant: "secondary", className: "mt-4" })}>Exit</Link></div>
      ) : sessionResult?.data && questions && answers ? (
        <QuizView key={`${sessionResult.data.id}:${sessionResult.data.revision}`}
          courseId={courseId} deckId={deckId} sessionId={sessionResult.data.id}
          questions={displayQuestions} answers={answers}
          initialIndex={sessionResult.data.current_index} initialRevision={sessionResult.data.revision}
          completed={Boolean(sessionResult.data.completed_at)} deckUrl={deckUrl} />
      ) : (
        <section className="surface-panel mt-8">
          <h2 className="section-title">Start a new quiz</h2>
          {readyCards.length < 2 ? <p className="page-description mt-2">Add at least two cards to this deck first.</p>
            : hasBlankAnswer ? <p className="page-description mt-2">Every card needs an answer before quizzing.</p>
              : distinctAnswers.size < 2 ? <p className="page-description mt-2">This deck needs two distinct answers.</p>
                : <p className="page-description mt-2">A new quiz saves its question and answer order so you can resume later.</p>}
          {query.error && <p role="alert" className="notice-error mt-4">Could not start a quiz. Please refresh and try again.</p>}
          <div className="mt-5 flex flex-wrap gap-3"><form action={startQuiz.bind(null, courseId, deckId)}><StartQuizButton disabled={cannotStart} /></form><Link href={deckUrl} className={buttonVariants({ variant: "secondary" })}>Exit</Link></div>
        </section>
      )}
    </main>
  );
}
