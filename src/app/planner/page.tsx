import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlannerWorkspace } from "./planner-workspace";

export default async function PlannerPage() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;

  const [
    semesters,
    plannerCourses,
    meetings,
    exceptions,
    courses,
    assignments,
    assignmentExceptions,
    customTypes,
    urls,
    subtasks,
    courseNotes,
    weeklyFocusItems,
    weeklyNotepads,
    attachments,
    attachmentRefs,
    decks,
    assignmentDecks,
    studySchedules,
    assignmentStudySchedules,
  ] = await Promise.all([
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
    supabase.from("planner_assignment_exceptions")
      .select("id, semester_id, parent_series_id, original_due_date, kind")
      .eq("user_id", userId),
    supabase.from("planner_custom_assignment_types")
      .select("id, name, created_at")
      .eq("user_id", userId).order("name"),
    supabase.from("planner_assignment_urls")
      .select("id, assignment_id, url, label, position")
      .eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("planner_assignment_subtasks")
      .select("id, assignment_id, title, is_done, due_date, position")
      .eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("planner_course_notes")
      .select("id, semester_id, planner_course_id, note_date, body, is_done, created_at, updated_at")
      .eq("user_id", userId).order("created_at", { ascending: true }),
    supabase.from("planner_weekly_focus_items")
      .select("id, semester_id, week_start, focus_date, position, title, is_done, assignment_id, occurrence_date, created_at, updated_at")
      .eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("planner_weekly_notepads")
      .select("semester_id, week_start, body").eq("user_id", userId),
    supabase.from("planner_assignment_attachments")
      .select("id, semester_id, assignment_id, storage_path, file_name, content_type, byte_size, created_at")
      .eq("user_id", userId),
    supabase.from("planner_assignment_attachment_refs")
      .select("assignment_id, attachment_id, position")
      .eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("decks").select("id, name, course_id").eq("user_id", userId).order("name"),
    supabase.from("planner_assignment_decks")
      .select("assignment_id, deck_id").eq("user_id", userId),
    supabase.from("study_schedules")
      .select("id, deck_id, name").eq("user_id", userId),
    supabase.from("planner_assignment_study_schedules")
      .select("assignment_id, study_schedule_id").eq("user_id", userId),
  ]);
  const failure = [
    semesters,
    plannerCourses,
    meetings,
    exceptions,
    courses,
    assignments,
    assignmentExceptions,
    customTypes,
    urls,
    subtasks,
    courseNotes,
    weeklyFocusItems,
    weeklyNotepads,
    attachments,
    attachmentRefs,
    decks,
    assignmentDecks,
    studySchedules,
    assignmentStudySchedules,
  ].find((result) => result.error);
  const scheduleIds = [...new Set((assignmentStudySchedules.data ?? []).map((link) => link.study_schedule_id))];
  const scheduleProgress: Record<string, { completed: number; total: number }> = {};
  if (!failure?.error && scheduleIds.length) {
    const { data: dates, error: datesError } = await supabase.from("study_schedule_dates")
      .select("id, study_schedule_id").in("study_schedule_id", scheduleIds);
    if (datesError) console.error("Failed to load Planner study schedule dates:", datesError);
    else {
      const dateIds = (dates ?? []).map((date) => date.id);
      const { data: sessions, error: sessionsError } = dateIds.length
        ? await supabase.from("study_sessions").select("study_schedule_date_id")
          .eq("user_id", userId).not("completed_at", "is", null)
          .in("study_schedule_date_id", dateIds)
        : { data: [], error: null };
      if (sessionsError) console.error("Failed to load Planner study completions:", sessionsError);
      else {
        const completed = new Set((sessions ?? []).map((session) => session.study_schedule_date_id));
        for (const id of scheduleIds) scheduleProgress[id] = { completed: 0, total: 0 };
        for (const date of dates ?? []) {
          scheduleProgress[date.study_schedule_id].total += 1;
          if (completed.has(date.id)) scheduleProgress[date.study_schedule_id].completed += 1;
        }
      }
    }
  }
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
          assignmentExceptions={(assignmentExceptions.data ?? []) as import("@/lib/planner/types").AssignmentException[]}
          customTypes={customTypes.data ?? []}
          urls={urls.data ?? []}
          subtasks={subtasks.data ?? []}
          courseNotes={(courseNotes.data ?? []) as import("@/lib/planner/types").PlannerCourseNote[]}
          weeklyFocusItems={(weeklyFocusItems.data ?? []) as import("@/lib/planner/types").PlannerWeeklyFocusItem[]}
          weeklyNotepads={weeklyNotepads.data ?? []}
          attachments={(attachments.data ?? []) as import("@/lib/planner/types").PlannerAssignmentAttachment[]}
          attachmentRefs={(attachmentRefs.data ?? []) as import("@/lib/planner/types").PlannerAssignmentAttachmentRef[]}
          hebacademyDecks={decks.data ?? []}
          assignmentDecks={assignmentDecks.data ?? []}
          studySchedules={studySchedules.data ?? []}
          assignmentStudySchedules={assignmentStudySchedules.data ?? []}
          scheduleProgress={scheduleProgress}
        />
      )}
    </main>
  );
}
