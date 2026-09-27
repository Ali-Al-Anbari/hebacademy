import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { isCalendarDate } from "@/lib/schedules";
import { ScheduleForm } from "./schedule-form";

export default async function NewSchedulePage({ searchParams }: {
  searchParams: Promise<{ assignment?: string; occurrence?: string; deck?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;

  const [coursesResult, decksResult] = await Promise.all([
    supabase.from("courses").select("id, name")
      .eq("user_id", userId).order("name"),
    supabase.from("decks").select("id, name, course_id")
      .eq("user_id", userId).order("name"),
  ]);
  if (coursesResult.error) console.error("Failed to load schedule courses:", coursesResult.error);
  if (decksResult.error) console.error("Failed to load schedule decks:", decksResult.error);
  const params = await searchParams;
  const requestedAssignment = params.assignment;
  const requestedDeck = params.deck;
  const requestedOccurrence = params.occurrence;
  let plannerContext: {
    assignmentId: string; occurrenceDate: string | null; deckId: string;
    courseId: string; name: string; examDate: string;
  } | null = null;
  if (requestedAssignment && requestedDeck &&
      /^[0-9a-f-]{36}$/i.test(requestedAssignment) && /^[0-9a-f-]{36}$/i.test(requestedDeck) &&
      (!requestedOccurrence || isCalendarDate(requestedOccurrence))) {
    const { data: assignment } = await supabase.from("planner_assignments")
      .select("id, title, type_kind, due_date, recurrence_kind, parent_series_id")
      .eq("id", requestedAssignment).eq("user_id", userId).maybeSingle();
    const deck = decksResult.data?.find((item) => item.id === requestedDeck);
    if (assignment?.type_kind === "exam" && deck &&
        (!requestedOccurrence || (assignment.recurrence_kind !== "none" && !assignment.parent_series_id))) {
      const { data: link } = await supabase.from("planner_assignment_decks")
        .select("deck_id").eq("assignment_id", assignment.id)
        .eq("deck_id", deck.id).eq("user_id", userId).maybeSingle();
      if (link) plannerContext = {
        assignmentId: assignment.id,
        occurrenceDate: requestedOccurrence ?? null,
        deckId: deck.id, courseId: deck.course_id,
        name: assignment.title, examDate: requestedOccurrence ?? assignment.due_date,
      };
    }
  }

  return (
    <main className="page-container page-container--narrow">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" }]} current="Create schedule" />
      <div className="page-intro mt-2">
        <h1 className="page-title">Create a study schedule</h1>
        <p className="page-description">Choose a deck, save its cards, and pick the days you want to review.</p>
      </div>
      {coursesResult.error || decksResult.error ? (
        <p role="alert" className="notice-error mt-6">Could not load your courses and decks. Please refresh and try again.</p>
      ) : !coursesResult.data?.length ? (
        <div className="empty-panel mt-6">
          <h2 className="empty-panel__title">Create a course first</h2>
          <p className="empty-panel__copy">Schedules use cards from one of your existing decks.</p>
          <Link href="/" className={buttonVariants({ className: "mt-5" })}>Back to Dashboard</Link>
        </div>
      ) : (
        <ScheduleForm courses={coursesResult.data} decks={decksResult.data ?? []}
          plannerContext={plannerContext} />
      )}
    </main>
  );
}
