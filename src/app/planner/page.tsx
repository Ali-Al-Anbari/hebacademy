import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlannerWorkspace } from "./planner-workspace";

export default async function PlannerPage() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;

  const [semesters, plannerCourses, meetings, exceptions, courses, assignments, customTypes, urls, subtasks] = await Promise.all([
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
    supabase.from("planner_assignments")
      .select("id, semester_id, planner_course_id, parent_series_id, original_due_date, title, description, start_date, due_date, due_time, type_kind, custom_type_id, status, priority, recurrence_kind, recurrence_interval, recurrence_weekdays, recurrence_end_kind, recurrence_until, created_at, updated_at")
      .eq("user_id", userId).order("due_date", { ascending: true }),
    supabase.from("planner_custom_assignment_types")
      .select("id, name, created_at")
      .eq("user_id", userId).order("name"),
    supabase.from("planner_assignment_urls")
      .select("id, assignment_id, url, label, position")
      .eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("planner_assignment_subtasks")
      .select("id, assignment_id, title, is_done, due_date, position")
      .eq("user_id", userId).order("position", { ascending: true }),
  ]);
  const failure = [semesters, plannerCourses, meetings, exceptions, courses, assignments, customTypes, urls, subtasks].find((result) => result.error);
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
          assignments={(assignments.data ?? []) as import("@/lib/planner/types").PlannerAssignment[]}
          customTypes={customTypes.data ?? []}
          urls={urls.data ?? []}
          subtasks={subtasks.data ?? []}
        />
      )}
    </main>
  );
}
