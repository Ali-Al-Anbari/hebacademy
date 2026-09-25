"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDateOnly, isTime, isValidHttpUrl } from "@/lib/planner/dates";
import {
  BUILTIN_ASSIGNMENT_TYPES,
  type AssignmentDraft,
  type AssignmentStatus,
  type PlannerCustomType,
} from "@/lib/planner/types";
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
  if (error) console.error("Planner semester verification failed:", error);
  return data && !error ? { ...context, semester: data } : null;
}

async function ownedAssignment(assignmentId: string) {
  const context = await authenticated();
  if (!isId(assignmentId)) return null;
  const { data, error } = await context.supabase
    .from("planner_assignments")
    .select("id, semester_id, planner_course_id, status")
    .eq("id", assignmentId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) console.error("Planner assignment verification failed:", error);
  return data && !error ? { ...context, assignment: data } : null;
}

export async function createCustomAssignmentType(name: string) {
  const context = await authenticated();
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > 60) {
    return { error: "Enter a custom type name of 1 to 60 characters.", customType: null as PlannerCustomType | null };
  }

  // Check if a type with this name already exists (case-insensitive)
  const { data: existing, error: checkError } = await context.supabase
    .from("planner_custom_assignment_types")
    .select("id, name")
    .eq("user_id", context.userId);

  if (checkError) {
    console.error("Could not check custom assignment types:", checkError);
    return { error: "Could not create custom assignment type. Please try again.", customType: null };
  }

  const normalized = trimmed.toLowerCase();
  const matched = (existing ?? []).find((item) => item.name.trim().toLowerCase() === normalized);
  if (matched) {
    return { error: null, customType: matched as PlannerCustomType };
  }

  const { data, error } = await context.supabase
    .from("planner_custom_assignment_types")
    .insert({ user_id: context.userId, name: trimmed })
    .select("id, name")
    .single();

  if (error || !data) {
    console.error("Could not create custom assignment type:", error);
    return { error: "Could not create custom assignment type.", customType: null };
  }

  revalidatePath("/planner");
  return { error: null, customType: data as PlannerCustomType };
}

function validateAssignmentDraft(input: AssignmentDraft) {
  if (!input || typeof input !== "object") return "Complete the assignment details.";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 200) {
    return "Enter an assignment title of 1 to 200 characters.";
  }
  if (!isDateOnly(input.due_date)) {
    return "A valid due date is required.";
  }
  if (input.start_date !== null && !isDateOnly(input.start_date)) {
    return "Enter a valid start date or leave it blank.";
  }
  if (input.start_date && input.start_date > input.due_date) {
    return "The start date must be on or before the due date.";
  }
  if (input.due_time !== null && !isTime(input.due_time)) {
    return "Enter a valid due time or leave it blank.";
  }

  const isBuiltin = (BUILTIN_ASSIGNMENT_TYPES as readonly string[]).includes(input.type_kind);
  if (!isBuiltin && input.type_kind !== "custom") {
    return "Select a valid assignment type.";
  }
  if (input.type_kind === "custom") {
    if (!input.custom_type_id || !isId(input.custom_type_id)) {
      return "Select or create a custom assignment type.";
    }
  } else if (input.custom_type_id !== null) {
    return "Standard assignment types must not have a custom type reference.";
  }

  if (input.planner_course_id !== null && !isId(input.planner_course_id)) {
    return "Select a valid planner class or none.";
  }
  if (!["not_started", "in_progress", "done"].includes(input.status)) {
    return "Invalid assignment status.";
  }
  if (!["normal", "important"].includes(input.priority)) {
    return "Invalid assignment priority.";
  }

  if (input.description !== null && typeof input.description === "string" && input.description.length > 3000) {
    return "Description must be under 3,000 characters.";
  }

  if (Array.isArray(input.urls)) {
    for (const [index, link] of input.urls.entries()) {
      if (!link || typeof link.url !== "string" || !isValidHttpUrl(link.url)) {
        return `Link #${index + 1} must be a valid http:// or https:// URL.`;
      }
      if (link.label && typeof link.label === "string" && link.label.trim().length > 100) {
        return `Link #${index + 1} label must be under 100 characters.`;
      }
    }
  }

  if (Array.isArray(input.subtasks)) {
    for (const [index, task] of input.subtasks.entries()) {
      if (!task || typeof task.title !== "string" || !task.title.trim()) {
        return `Subtask #${index + 1} must have a title.`;
      }
      if (task.title.trim().length > 200) {
        return `Subtask #${index + 1} title must be under 200 characters.`;
      }
      if (task.due_date !== null && task.due_date !== undefined && task.due_date !== "" && !isDateOnly(task.due_date)) {
        return `Subtask #${index + 1} has an invalid due date.`;
      }
    }
  }

  return null;
}

export async function saveAssignment(
  id: string | null,
  semesterId: string,
  input: AssignmentDraft
): Promise<{ error: string | null; id: string | null }> {
  const invalid = validateAssignmentDraft(input);
  if (invalid) return { error: invalid, id: null };

  const semContext = await ownedSemester(semesterId);
  if (!semContext) return { error: "This semester is unavailable.", id: null };
  const { supabase, userId } = semContext;

  // Verify planner course belongs to this semester and user if provided
  if (input.planner_course_id) {
    const { data: courseData, error: courseError } = await supabase
      .from("planner_courses")
      .select("id")
      .eq("id", input.planner_course_id)
      .eq("semester_id", semesterId)
      .eq("user_id", userId)
      .maybeSingle();

    if (courseError || !courseData) {
      if (courseError) console.error("Could not verify assignment course:", courseError);
      return { error: "The selected planner class is not available in this semester.", id: null };
    }
  }

  // Verify custom type belongs to user if custom
  if (input.type_kind === "custom" && input.custom_type_id) {
    const { data: typeData, error: typeError } = await supabase
      .from("planner_custom_assignment_types")
      .select("id")
      .eq("id", input.custom_type_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (typeError || !typeData) {
      if (typeError) console.error("Could not verify custom assignment type:", typeError);
      return { error: "The selected custom type is not available.", id: null };
    }
  }

  const assignmentValues = {
    semester_id: semesterId,
    planner_course_id: input.planner_course_id,
    parent_series_id: null,
    original_due_date: null,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    start_date: input.start_date || null,
    due_date: input.due_date,
    due_time: input.due_time ? input.due_time.slice(0, 5) : null,
    type_kind: input.type_kind,
    custom_type_id: input.type_kind === "custom" ? input.custom_type_id : null,
    status: input.status,
    priority: input.priority,
    recurrence_kind: "none",
    recurrence_interval: 1,
    recurrence_weekdays: null,
    recurrence_end_kind: "none",
    recurrence_until: null,
    updated_at: new Date().toISOString(),
  };

  let targetId = id;

  if (id !== null) {
    // Check ownership of existing assignment
    const assignContext = await ownedAssignment(id);
    if (!assignContext || assignContext.assignment.semester_id !== semesterId) {
      return { error: "This assignment is unavailable.", id: null };
    }

    const { data, error } = await supabase
      .from("planner_assignments")
      .update(assignmentValues)
      .eq("id", id)
      .eq("user_id", userId)
      .eq("semester_id", semesterId)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      console.error("Could not update planner assignment:", error);
      return { error: "Could not save the assignment. Please try again.", id: null };
    }
  } else {
    // Insert new assignment
    const { data, error } = await supabase
      .from("planner_assignments")
      .insert({
        ...assignmentValues,
        user_id: userId,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("Could not create planner assignment:", error);
      return { error: "Could not create the assignment. Please try again.", id: null };
    }
    targetId = data.id;
  }

  if (!targetId) {
    return { error: "Unexpected missing assignment ID.", id: null };
  }

  // Sync URLs
  try {
    const urlsToInsert = (input.urls || []).map((link, idx) => ({
      id: isId(link.id) ? link.id : crypto.randomUUID(),
      user_id: userId,
      semester_id: semesterId,
      assignment_id: targetId,
      url: link.url.trim(),
      label: link.label?.trim() || null,
      position: idx,
    }));

    // Delete existing URLs for this assignment
    const { error: delUrlError } = await supabase
      .from("planner_assignment_urls")
      .delete()
      .eq("assignment_id", targetId)
      .eq("user_id", userId);

    if (delUrlError) {
      console.error("Could not clear old URLs:", delUrlError);
      throw delUrlError;
    }

    if (urlsToInsert.length > 0) {
      const { error: insUrlError } = await supabase
        .from("planner_assignment_urls")
        .insert(urlsToInsert);

      if (insUrlError) {
        console.error("Could not insert URLs:", insUrlError);
        throw insUrlError;
      }
    }
  } catch (urlErr) {
    console.error("Failed to save assignment URLs:", urlErr);
    revalidatePath("/planner");
    return {
      error: "The assignment was saved, but some URLs could not be updated. Please review them.",
      id: targetId,
    };
  }

  // Sync Subtasks
  try {
    const subtasksToInsert = (input.subtasks || []).map((task, idx) => ({
      id: isId(task.id) ? task.id : crypto.randomUUID(),
      user_id: userId,
      semester_id: semesterId,
      assignment_id: targetId,
      title: task.title.trim(),
      is_done: Boolean(task.is_done),
      due_date: task.due_date && isDateOnly(task.due_date) ? task.due_date : null,
      position: idx,
      updated_at: new Date().toISOString(),
    }));

    // Delete existing subtasks for this assignment
    const { error: delSubError } = await supabase
      .from("planner_assignment_subtasks")
      .delete()
      .eq("assignment_id", targetId)
      .eq("user_id", userId);

    if (delSubError) {
      console.error("Could not clear old subtasks:", delSubError);
      throw delSubError;
    }

    if (subtasksToInsert.length > 0) {
      const { error: insSubError } = await supabase
        .from("planner_assignment_subtasks")
        .insert(subtasksToInsert);

      if (insSubError) {
        console.error("Could not insert subtasks:", insSubError);
        throw insSubError;
      }
    }
  } catch (subErr) {
    console.error("Failed to save assignment subtasks:", subErr);
    revalidatePath("/planner");
    return {
      error: "The assignment was saved, but some subtasks could not be updated. Please review them.",
      id: targetId,
    };
  }

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null, id: targetId };
}

export async function deleteAssignment(id: string): Promise<{ error: string | null }> {
  const context = await ownedAssignment(id);
  if (!context) return { error: "This assignment is unavailable." };

  const { data, error } = await context.supabase
    .from("planner_assignments")
    .delete()
    .eq("id", id)
    .eq("user_id", context.userId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("Could not delete planner assignment:", error);
    return { error: "Could not delete the assignment. Please try again." };
  }

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null };
}

export async function toggleAssignmentStatus(
  id: string,
  currentStatus: AssignmentStatus
): Promise<{ error: string | null; status: AssignmentStatus | null }> {
  const context = await ownedAssignment(id);
  if (!context) return { error: "This assignment is unavailable.", status: null };

  const nextStatus: AssignmentStatus = currentStatus === "done" ? "not_started" : "done";
  const { data, error } = await context.supabase
    .from("planner_assignments")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", context.userId)
    .select("status")
    .maybeSingle();

  if (error || !data) {
    console.error("Could not toggle assignment status:", error);
    return { error: "Could not change the assignment status.", status: null };
  }

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null, status: data.status as AssignmentStatus };
}

export async function toggleSubtask(
  subtaskId: string,
  assignmentId: string,
  currentDone: boolean
): Promise<{ error: string | null; is_done: boolean | null }> {
  const context = await ownedAssignment(assignmentId);
  if (!context || !isId(subtaskId)) return { error: "This subtask is unavailable.", is_done: null };

  const nextDone = !currentDone;
  const { data, error } = await context.supabase
    .from("planner_assignment_subtasks")
    .update({
      is_done: nextDone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subtaskId)
    .eq("assignment_id", assignmentId)
    .eq("user_id", context.userId)
    .select("is_done")
    .maybeSingle();

  if (error || !data) {
    console.error("Could not toggle subtask status:", error);
    return { error: "Could not change the subtask status.", is_done: null };
  }

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null, is_done: data.is_done };
}
