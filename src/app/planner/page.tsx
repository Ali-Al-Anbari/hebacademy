import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlannerWorkspace } from "./planner-workspace";

export default async function PlannerPage() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;

  const [semesters, plannerCourses, meetings, exceptions, courses] = await Promise.all([
    supabase.from("planner_semesters")
      .select("id, name, start_date, end_date, time_zone, archived_at, created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("planner_courses")
      .select("id, semester_id, hebacademy_course_id, name, color")
      .eq("user_id", userId).order("name"),
    supabase.from("planner_course_meetings")
      .select("id, semester_id, planner_course_id, weekday, starts_at, ends_at, location")
      .eq("user_id", userId).order("weekday"),
    supabase.from("planner_meeting_exceptions")
      .select("id, semester_id, meeting_id, original_date, kind, replacement_date, replacement_starts_at, replacement_ends_at, replacement_location")
      .eq("user_id", userId),
    supabase.from("courses").select("id, name").eq("user_id", userId).order("name"),
  ]);
  const failure = [semesters, plannerCourses, meetings, exceptions, courses].find((result) => result.error);
  if (failure?.error) console.error("Failed to load planner:", failure.error);

  return (
    <main className="page-container planner-page">
      {failure?.error ? (
        <><h1 className="page-title">Academic Planner</h1>
          <p role="alert" className="notice-error mt-5">Could not load your planner. Refresh and try again.</p></>
      ) : (
        <PlannerWorkspace
          semesters={semesters.data ?? []}
          courses={plannerCourses.data ?? []}
          meetings={meetings.data ?? []}
          exceptions={(exceptions.data ?? []) as import("@/lib/planner/types").MeetingException[]}
          hebacademyCourses={courses.data ?? []}
        />
      )}
    </main>
  );
}
