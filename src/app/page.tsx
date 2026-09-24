import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCompletedScheduleDateIds } from "@/lib/schedule-data";
import { CourseManager } from "./course-manager";
import { ScheduleDashboardCard } from "./schedule-dashboard-card";

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
      <section className="mt-10" aria-labelledby="study-schedules-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 id="study-schedules-title" className="section-title">Study schedules</h2><p className="page-description mt-1">Choose cards and review dates for an exam or study period.</p></div>
          <Link href="/study-schedules/new" className={buttonVariants({ variant: "secondary", className: "w-full sm:w-auto" })}><Plus /> Create Schedule</Link>
        </div>
        {schedulesError || scheduleHistoryError ? <p role="alert" className="notice-error mt-4">Could not load your schedules. Please refresh and try again.</p>
          : activeSchedules.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{activeSchedules.map((schedule) => {
              const deck = firstRelation(schedule.decks);
              const course = firstRelation(deck?.courses ?? null);
              return <ScheduleDashboardCard key={schedule.id} id={schedule.id} name={schedule.name} course={course?.name ?? "Course"} deck={deck?.name ?? "Deck"} cardCount={schedule.study_schedule_cards[0]?.count ?? 0} examDate={schedule.exam_date} dates={schedule.study_schedule_dates.map((date) => ({ reviewDate: date.review_date, completed: completedDateIds.has(date.id) })).sort((a, b) => a.reviewDate.localeCompare(b.reviewDate))} />;
            })}</div>
            : <div className="empty-panel mt-4"><h3 className="empty-panel__title">No active study schedules</h3><p className="empty-panel__copy">Create a schedule when you want to plan reviews for a deck.{archivedSchedules.length > 0 && " Your archived schedules are below."}</p></div>}
        {!schedulesError && !scheduleHistoryError && archivedSchedules.length > 0 && <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">Archived schedules ({archivedSchedules.length})</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{archivedSchedules.map((schedule) => <Card key={schedule.id} className="py-0"><CardContent className="p-5"><Link href={`/study-schedules/${schedule.id}`} className="block rounded-sm font-semibold text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{schedule.name}</Link></CardContent></Card>)}</div></details>}
      </section>
    </main>
  );
}
