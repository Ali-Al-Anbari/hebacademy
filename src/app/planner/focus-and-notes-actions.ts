"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDateOnly, weekdayOf } from "@/lib/planner/dates";
import type { PlannerCourseNote, PlannerWeeklyFocusItem } from "@/lib/planner/types";
import { createClient } from "@/lib/supabase/server";

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function authenticated() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  return { supabase, userId: data.claims.sub };
}

async function ownedSemester(semesterId: string) {
  const context = await authenticated();
  if (!isId(semesterId)) return null;
  const { data, error } = await context.supabase
    .from("planner_semesters")
    .select("id, start_date, end_date")
    .eq("id", semesterId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) console.error("Semester verification failed:", error);
  return data && !error ? { ...context, semester: data } : null;
}

async function ownedCourse(semesterId: string, courseId: string) {
  const context = await ownedSemester(semesterId);
  if (!context || !isId(courseId)) return null;
  const { data, error } = await context.supabase
    .from("planner_courses")
    .select("id, semester_id, name")
    .eq("id", courseId)
    .eq("semester_id", semesterId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) console.error("Course verification failed:", error);
  return data && !error ? { ...context, course: data } : null;
}

async function ownedAssignment(semesterId: string, assignmentId: string) {
  const context = await ownedSemester(semesterId);
  if (!context || !isId(assignmentId)) return null;
  const { data, error } = await context.supabase
    .from("planner_assignments")
    .select("id, semester_id, title, status")
    .eq("id", assignmentId)
    .eq("semester_id", semesterId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) console.error("Assignment verification failed:", error);
  return data && !error ? { ...context, assignment: data } : null;
}

// ==========================================
// COURSE NOTES / TOPICS ACTIONS
// ==========================================

export async function createCourseNote({
  semesterId,
  courseId,
  noteDate,
  body,
}: {
  semesterId: string;
  courseId: string;
  noteDate: string;
  body: string;
}): Promise<{ error: string | null; note: PlannerCourseNote | null }> {
  const context = await ownedCourse(semesterId, courseId);
  if (!context) {
    return { error: "Class or semester could not be verified.", note: null };
  }
  if (!isDateOnly(noteDate)) {
    return { error: "A valid calendar date is required.", note: null };
  }
  const trimmed = typeof body === "string" ? body.trim() : "";
  if (!trimmed || trimmed.length > 2000) {
    return { error: "Enter a topic or note (up to 2000 characters).", note: null };
  }

  const { data, error } = await context.supabase
    .from("planner_course_notes")
    .insert({
      user_id: context.userId,
      semester_id: semesterId,
      planner_course_id: courseId,
      note_date: noteDate,
      body: trimmed,
      is_done: false,
    })
    .select("id, semester_id, planner_course_id, note_date, body, is_done, created_at, updated_at")
    .single();

  if (error || !data) {
    console.error("Could not create course note:", error);
    return { error: "Could not create note. Please try again.", note: null };
  }

  revalidatePath("/planner");
  return { error: null, note: data as PlannerCourseNote };
}

export async function updateCourseNote({
  noteId,
  body,
}: {
  noteId: string;
  body: string;
}): Promise<{ error: string | null }> {
  const context = await authenticated();
  if (!isId(noteId)) {
    return { error: "Invalid note ID." };
  }
  const trimmed = typeof body === "string" ? body.trim() : "";
  if (!trimmed || trimmed.length > 2000) {
    return { error: "Enter a topic or note (up to 2000 characters)." };
  }

  const { error } = await context.supabase
    .from("planner_course_notes")
    .update({
      body: trimmed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("user_id", context.userId);

  if (error) {
    console.error("Could not update course note:", error);
    return { error: "Could not update note." };
  }

  revalidatePath("/planner");
  return { error: null };
}

export async function toggleCourseNote(
  noteId: string,
  currentDone: boolean
): Promise<{ error: string | null }> {
  const context = await authenticated();
  if (!isId(noteId)) {
    return { error: "Invalid note ID." };
  }

  const { error } = await context.supabase
    .from("planner_course_notes")
    .update({
      is_done: !currentDone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("user_id", context.userId);

  if (error) {
    console.error("Could not toggle note:", error);
    return { error: "Could not update note." };
  }

  revalidatePath("/planner");
  return { error: null };
}

export async function deleteCourseNote(noteId: string): Promise<{ error: string | null }> {
  const context = await authenticated();
  if (!isId(noteId)) {
    return { error: "Invalid note ID." };
  }

  const { error } = await context.supabase
    .from("planner_course_notes")
    .delete()
    .eq("id", noteId)
    .eq("user_id", context.userId);

  if (error) {
    console.error("Could not delete note:", error);
    return { error: "Could not delete note." };
  }

  revalidatePath("/planner");
  return { error: null };
}

// ==========================================
// WEEKLY FOCUS ACTIONS
// ==========================================

export async function addFreeformFocusItem({
  semesterId,
  weekStart,
  title,
}: {
  semesterId: string;
  weekStart: string;
  title: string;
}): Promise<{ error: string | null; item: PlannerWeeklyFocusItem | null }> {
  const context = await ownedSemester(semesterId);
  if (!context) {
    return { error: "Semester could not be verified.", item: null };
  }
  if (!isDateOnly(weekStart) || weekdayOf(weekStart) !== 1) {
    return { error: "Weekly focus must start on a Monday.", item: null };
  }
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (!trimmed || trimmed.length > 500) {
    return { error: "Enter a focus item (up to 500 characters).", item: null };
  }

  // Find next position in this week
  const { data: maxPosData } = await context.supabase
    .from("planner_weekly_focus_items")
    .select("position")
    .eq("user_id", context.userId)
    .eq("semester_id", semesterId)
    .eq("week_start", weekStart)
    .order("position", { ascending: false })
    .limit(1);

  const nextPos = (maxPosData?.[0]?.position ?? -1) + 1;

  const { data, error } = await context.supabase
    .from("planner_weekly_focus_items")
    .insert({
      user_id: context.userId,
      semester_id: semesterId,
      week_start: weekStart,
      position: nextPos,
      title: trimmed,
      is_done: false,
      assignment_id: null,
      occurrence_date: null,
    })
    .select("id, semester_id, week_start, position, title, is_done, assignment_id, occurrence_date, created_at, updated_at")
    .single();

  if (error || !data) {
    console.error("Could not add weekly focus item:", error);
    return { error: "Could not add focus item.", item: null };
  }

  revalidatePath("/planner");
  return { error: null, item: data as PlannerWeeklyFocusItem };
}

export async function toggleFreeformFocusItem(
  itemId: string,
  currentDone: boolean
): Promise<{ error: string | null }> {
  const context = await authenticated();
  if (!isId(itemId)) {
    return { error: "Invalid focus item ID." };
  }

  const { error } = await context.supabase
    .from("planner_weekly_focus_items")
    .update({
      is_done: !currentDone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("user_id", context.userId)
    .is("assignment_id", null); // DB check constraint: assignment_id must be null for is_done to be true

  if (error) {
    console.error("Could not toggle weekly focus item:", error);
    return { error: "Could not update focus item." };
  }

  revalidatePath("/planner");
  return { error: null };
}

export async function pinAssignmentToFocus({
  semesterId,
  weekStart,
  assignmentId,
}: {
  semesterId: string;
  weekStart: string;
  assignmentId: string;
}): Promise<{ error: string | null; item: PlannerWeeklyFocusItem | null }> {
  const context = await ownedAssignment(semesterId, assignmentId);
  if (!context) {
    return { error: "Assignment could not be verified.", item: null };
  }
  if (!isDateOnly(weekStart) || weekdayOf(weekStart) !== 1) {
    return { error: "Weekly focus must start on a Monday.", item: null };
  }

  // Check if already pinned for this week
  const { data: existing } = await context.supabase
    .from("planner_weekly_focus_items")
    .select("id, semester_id, week_start, position, title, is_done, assignment_id, occurrence_date, created_at, updated_at")
    .eq("user_id", context.userId)
    .eq("semester_id", semesterId)
    .eq("week_start", weekStart)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (existing) {
    return { error: null, item: existing as PlannerWeeklyFocusItem };
  }

  // Find next position in this week
  const { data: maxPosData } = await context.supabase
    .from("planner_weekly_focus_items")
    .select("position")
    .eq("user_id", context.userId)
    .eq("semester_id", semesterId)
    .eq("week_start", weekStart)
    .order("position", { ascending: false })
    .limit(1);

  const nextPos = (maxPosData?.[0]?.position ?? -1) + 1;

  // Migration constraint:
  // (assignment_id is not null and title is null and not is_done)
  const { data, error } = await context.supabase
    .from("planner_weekly_focus_items")
    .insert({
      user_id: context.userId,
      semester_id: semesterId,
      week_start: weekStart,
      position: nextPos,
      title: null,
      is_done: false,
      assignment_id: assignmentId,
      occurrence_date: null,
    })
    .select("id, semester_id, week_start, position, title, is_done, assignment_id, occurrence_date, created_at, updated_at")
    .single();

  if (error || !data) {
    console.error("Could not pin assignment to weekly focus:", error);
    return { error: "Could not pin assignment.", item: null };
  }

  revalidatePath("/planner");
  return { error: null, item: data as PlannerWeeklyFocusItem };
}

export async function deleteWeeklyFocusItem(itemId: string): Promise<{ error: string | null }> {
  const context = await authenticated();
  if (!isId(itemId)) {
    return { error: "Invalid item ID." };
  }

  // Deleting the row in planner_weekly_focus_items removes ONLY the focus item/pin.
  // The referenced assignment in planner_assignments is completely preserved.
  const { error } = await context.supabase
    .from("planner_weekly_focus_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", context.userId);

  if (error) {
    console.error("Could not remove weekly focus item:", error);
    return { error: "Could not remove item." };
  }

  revalidatePath("/planner");
  return { error: null };
}

export async function reorderWeeklyFocusItems({
  semesterId,
  weekStart,
  orderedIds,
}: {
  semesterId: string;
  weekStart: string;
  orderedIds: string[];
}): Promise<{ error: string | null }> {
  const context = await ownedSemester(semesterId);
  if (!context) {
    return { error: "Semester could not be verified." };
  }
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => !isId(id))) {
    return { error: "Invalid order data." };
  }

  await Promise.all(
    orderedIds.map((id, index) =>
      context.supabase
        .from("planner_weekly_focus_items")
        .update({ position: index })
        .eq("id", id)
        .eq("user_id", context.userId)
        .eq("semester_id", semesterId)
        .eq("week_start", weekStart)
    )
  );

  revalidatePath("/planner");
  return { error: null };
}
