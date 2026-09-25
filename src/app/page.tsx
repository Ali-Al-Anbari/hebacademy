import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { getCompletedScheduleDateIds } from "@/lib/schedule-data";
import { CourseManager } from "./course-manager";
import { ScheduleDashboardCard } from "./schedule-dashboard-card";
import { DashboardPlannerCard } from "./dashboard-planner-card";

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const { data: courses, error: coursesError } = await supabase
    .from("courses")
    .select("id, name, decks(count)")
    .eq("user_id", data.claims.sub)
    .order("created_at", { ascending: false });
  if (coursesError) console.error("Failed to load courses:", coursesError);

  const { data: schedules, error: schedulesError } = await supabase
    .from("study_schedules")
    .select("id, name, exam_date, archived_at, decks(name, courses(name)), study_schedule_cards(count), study_schedule_dates(id, review_date)")
    .eq("user_id", data.claims.sub)
    .order("created_at", { ascending: false });
  if (schedulesError) console.error("Failed to load study schedules:", schedulesError);
  let completedDateIds = new Set<string>();
  let scheduleHistoryError = false;
  if (!schedulesError && schedules?.length) {
    try {
      completedDateIds = await getCompletedScheduleDateIds(supabase, data.claims.sub,
        schedules.flatMap((schedule) => schedule.study_schedule_dates.map((date) => date.id)));
    } catch (error) {
      console.error("Failed to load schedule review progress:", error);
      scheduleHistoryError = true;
    }
  }
  const activeSchedules = (schedules ?? []).filter((schedule) => !schedule.archived_at);
  const archivedSchedules = (schedules ?? []).filter((schedule) => schedule.archived_at);

  return (
    <main className="page-container">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="min-w-0">
          {coursesError ? (
            <>
              <div className="page-intro">
                <p className="page-eyebrow">Your workspace</p>
                <h1 className="page-title">Your Courses</h1>
                <p className="page-description">Pick up where you left off and explore your study decks.</p>
              </div>
              <p role="alert" className="notice-error mt-5">Could not load your courses. Please refresh and try again.</p>
            </>
          ) : (
            <CourseManager courses={(courses ?? []).map((course) => ({
              id: course.id,
              name: course.name,
              deckCount: course.decks[0]?.count ?? 0,
            }))} />
          )}
        </div>
        <aside className="w-full">
          <DashboardPlannerCard />
        </aside>
      </div>
      <section className="dashboard-schedules mt-9" aria-labelledby="study-schedules-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 id="study-schedules-title" className="section-title">Study schedules</h2><p className="page-description mt-1">Choose cards and review dates for an exam or study period.</p></div>
          <Link href="/study-schedules/new" className={buttonVariants({ variant: "secondary", className: "w-full bg-brand-200 hover:bg-brand-300 sm:w-auto" })}>Create Schedule</Link>
        </div>
        {schedulesError || scheduleHistoryError ? <p role="alert" className="notice-error mt-4">Could not load your schedules. Please refresh and try again.</p>
          : activeSchedules.length ? <div className="mt-4">{activeSchedules.map((schedule) => {
              const deck = firstRelation(schedule.decks);
              const course = firstRelation(deck?.courses ?? null);
              return <ScheduleDashboardCard key={schedule.id} id={schedule.id} name={schedule.name} course={course?.name ?? "Course"} deck={deck?.name ?? "Deck"} cardCount={schedule.study_schedule_cards[0]?.count ?? 0} examDate={schedule.exam_date} dates={schedule.study_schedule_dates.map((date) => ({ reviewDate: date.review_date, completed: completedDateIds.has(date.id) })).sort((a, b) => a.reviewDate.localeCompare(b.reviewDate))} />;
            })}</div>
            : <div className="schedule-row mt-4 border-b py-6"><h3 className="text-lg font-semibold">No active study schedules</h3><p className="mt-1 text-sm text-muted-foreground">Create a schedule when you want to plan reviews for a deck.{archivedSchedules.length > 0 && " Your archived schedules are below."}</p></div>}
        {!schedulesError && !scheduleHistoryError && <details className="mt-6 border-t border-border pt-5"><summary className="cursor-pointer text-sm font-semibold text-foreground hover:underline">Archived schedules ({archivedSchedules.length})</summary>{archivedSchedules.length ? <div className="mt-3">{archivedSchedules.map((schedule) => <div key={schedule.id} className="schedule-row px-1 py-3"><Link href={`/study-schedules/${schedule.id}`} className="block break-words rounded-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{schedule.name}</Link></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No archived schedules yet.</p>}</details>}
      </section>
    </main>
  );
}
