"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addDays, isDateOnly, weekdayOf } from "@/lib/planner/dates";
import { parseVirtualAssignmentId } from "@/lib/planner/recurrence";
import { focusTextPatch } from "@/lib/planner/focus-edit";
import type { PlannerCourseNote, PlannerWeeklyFocusItem } from "@/lib/planner/types";
import { createClient } from "@/lib/supabase/server";

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const validFocusDay = (weekStart: string, focusDate: string) =>
  isDateOnly(weekStart) && weekdayOf(weekStart) === 1 &&
  isDateOnly(focusDate) && focusDate >= weekStart && focusDate <= addDays(weekStart, 6);

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
  focusDate,
  title,
}: {
  semesterId: string;
  weekStart: string;
  focusDate: string;
  title: string;
}): Promise<{ error: string | null; item: PlannerWeeklyFocusItem | null }> {
  const context = await ownedSemester(semesterId);
  if (!context) {
    return { error: "Semester could not be verified.", item: null };
  }
  if (!validFocusDay(weekStart, focusDate)) {
    return { error: "Choose a day in this Monday–Sunday week.", item: null };
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
    .eq("focus_date", focusDate)
    .order("position", { ascending: false })
    .limit(1);

  const nextPos = (maxPosData?.[0]?.position ?? -1) + 1;

  const { data, error } = await context.supabase
    .from("planner_weekly_focus_items")
    .insert({
      user_id: context.userId,
      semester_id: semesterId,
      week_start: weekStart,
      focus_date: focusDate,
      position: nextPos,
      title: trimmed,
      is_done: false,
      assignment_id: null,
      occurrence_date: null,
    })
    .select("id, semester_id, week_start, focus_date, position, title, is_done, assignment_id, occurrence_date, created_at, updated_at")
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

export async function updateWeeklyFocusItemText(itemId: string, title: string): Promise<{ error: string | null }> {
  const context = await authenticated();
  const patch = focusTextPatch(title, new Date().toISOString());
  if (!isId(itemId) || !patch) {
    return { error: "Enter a focus item (up to 500 characters)." };
  }
  const { data, error, status, statusText } = await context.supabase.from("planner_weekly_focus_items")
    .update(patch)
    .eq("id", itemId).eq("user_id", context.userId)
    .select("id").maybeSingle();
  if (error || !data) {
    if (process.env.NODE_ENV === "development") console.error("Could not edit Weekly Focus item", { itemId, status, statusText, code: error?.code, message: error?.message, details: error?.details, hint: error?.hint });
    return { error: error?.code === "23514" ? "Editing pinned assignment text requires the pending Weekly Focus migration." : "Could not save the focus item. Please try again." };
  }
  revalidatePath("/planner");
  return { error: null };
}

export async function pinAssignmentToFocus({
  semesterId,
  weekStart,
  focusDate,
  assignmentId,
  occurrenceDate,
}: {
  semesterId: string;
  weekStart: string;
  focusDate: string;
  assignmentId: string;
  occurrenceDate?: string | null;
}): Promise<{ error: string | null; item: PlannerWeeklyFocusItem | null }> {
  const parsed = parseVirtualAssignmentId(assignmentId);
  const realAssignmentId = parsed ? parsed.rootId : assignmentId;
  const realOccurrenceDate = occurrenceDate ?? (parsed ? parsed.occurrenceDate : null);

  const context = await ownedAssignment(semesterId, realAssignmentId);
  if (!context) {
    return { error: "Assignment could not be verified.", item: null };
  }
  if (!validFocusDay(weekStart, focusDate)) {
    return { error: "Choose a day in this Monday–Sunday week.", item: null };
  }

  // Check if already pinned for this week
  let existingQuery = context.supabase
    .from("planner_weekly_focus_items")
    .select("id, semester_id, week_start, focus_date, position, title, is_done, assignment_id, occurrence_date, created_at, updated_at")
    .eq("user_id", context.userId)
    .eq("semester_id", semesterId)
    .eq("week_start", weekStart)
    .eq("assignment_id", realAssignmentId);

  if (realOccurrenceDate) {
    existingQuery = existingQuery.eq("occurrence_date", realOccurrenceDate);
  } else {
    existingQuery = existingQuery.is("occurrence_date", null);
  }

  const { data: existing } = await existingQuery.maybeSingle();

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
    .eq("focus_date", focusDate)
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
      focus_date: focusDate,
      position: nextPos,
      title: null,
      is_done: false,
      assignment_id: realAssignmentId,
      occurrence_date: realOccurrenceDate,
    })
    .select("id, semester_id, week_start, focus_date, position, title, is_done, assignment_id, occurrence_date, created_at, updated_at")
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
  focusDate,
  orderedIds,
}: {
  semesterId: string;
  weekStart: string;
  focusDate: string;
  orderedIds: string[];
}): Promise<{ error: string | null }> {
  const context = await ownedSemester(semesterId);
  if (!context) {
    return { error: "Semester could not be verified." };
  }
  if (!validFocusDay(weekStart, focusDate)) return { error: "Choose a day in this week." };
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => !isId(id))
    || new Set(orderedIds).size !== orderedIds.length) {
    return { error: "Invalid order data." };
  }

  const { data: currentItems, error: loadError } = await context.supabase
    .from("planner_weekly_focus_items")
    .select("id")
    .eq("user_id", context.userId)
    .eq("semester_id", semesterId)
    .eq("week_start", weekStart)
    .eq("focus_date", focusDate);
  if (loadError || !currentItems || currentItems.length !== orderedIds.length
    || currentItems.some((item) => !orderedIds.includes(item.id))) {
    if (loadError) console.error("Could not verify weekly focus order:", loadError);
    return { error: "The weekly focus list changed. Refresh and try again." };
  }

  const results = await Promise.all(
    orderedIds.map((id, index) =>
      context.supabase
        .from("planner_weekly_focus_items")
        .update({ position: index })
        .eq("id", id)
        .eq("user_id", context.userId)
        .eq("semester_id", semesterId)
        .eq("week_start", weekStart)
        .eq("focus_date", focusDate)
        .select("id")
        .maybeSingle()
    )
  );
  if (results.some((result) => result.error || !result.data)) {
    console.error("Could not reorder weekly focus items:", results.filter((result) => result.error).map((result) => result.error));
    revalidatePath("/planner");
    return { error: "The order could not be fully saved. Refresh and try again." };
  }

  revalidatePath("/planner");
  return { error: null };
}

export async function moveWeeklyFocusItem(itemId: string, focusDate: string): Promise<{ error: string | null }> {
  const context = await authenticated();
  if (!isId(itemId)) return { error: "Invalid focus item." };
  const { data: item, error: loadError } = await context.supabase.from("planner_weekly_focus_items")
    .select("id, week_start, semester_id").eq("id", itemId).eq("user_id", context.userId).maybeSingle();
  if (loadError || !item) return { error: "Focus item is no longer available." };
  if (!validFocusDay(item.week_start, focusDate)) return { error: "Choose a day in this week." };
  const { data: last } = await context.supabase.from("planner_weekly_focus_items")
    .select("position").eq("user_id", context.userId).eq("semester_id", item.semester_id)
    .eq("week_start", item.week_start).eq("focus_date", focusDate)
    .order("position", { ascending: false }).limit(1);
  const { data, error } = await context.supabase.from("planner_weekly_focus_items")
    .update({ focus_date: focusDate, position: (last?.[0]?.position ?? -1) + 1, updated_at: new Date().toISOString() })
    .eq("id", itemId).eq("user_id", context.userId).select("id").maybeSingle();
  if (error || !data) return { error: "Could not move focus item." };
  revalidatePath("/planner");
  return { error: null };
}

export async function saveWeeklyNotepad({ semesterId, weekStart, body }: {
  semesterId: string; weekStart: string; body: string;
}): Promise<{ error: string | null }> {
  const context = await ownedSemester(semesterId);
  if (!context) return { error: "Semester could not be verified." };
  if (!isDateOnly(weekStart) || weekdayOf(weekStart) !== 1 || typeof body !== "string" || body.length > 20000) {
    return { error: "Invalid week notes." };
  }
  const { error } = await context.supabase.from("planner_weekly_notepads").upsert({
    user_id: context.userId, semester_id: semesterId, week_start: weekStart,
    body, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,semester_id,week_start" });
  if (error) return { error: "Could not save week notes. Please try again." };
  return { error: null };
}
