import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CourseManager } from "./course-manager";

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
    .select("id, name")
    .eq("user_id", data.claims.sub)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (schedulesError) console.error("Failed to load study schedules:", schedulesError);

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
          <Button render={<Link href="/study-schedules/new" />} variant="secondary" className="w-full sm:w-auto"><Plus /> Create Schedule</Button>
        </div>
        {schedulesError ? <p role="alert" className="notice-error mt-4">Could not load your schedules. Please refresh and try again.</p>
          : schedules?.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{schedules.map((schedule) => <Card key={schedule.id} className="py-0 transition-colors hover:border-[#c9a1b1]"><CardContent className="p-5"><Link href={`/study-schedules/${schedule.id}`} className="block rounded-sm font-semibold text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{schedule.name}</Link></CardContent></Card>)}</div>
            : <div className="empty-panel mt-4"><h3 className="empty-panel__title">No study schedules yet</h3><p className="empty-panel__copy">Create one when you want to plan reviews for a specific deck.</p></div>}
      </section>
    </main>
  );
}
