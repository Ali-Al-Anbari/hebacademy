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
    .select("id, semester_id, planner_course_id, status, parent_series_id")
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

  // Recurrence validation
  const recurrenceKind = input.recurrence_kind || "none";
  if (!["none", "daily", "selected_weekdays", "weekly", "every_x_weeks", "monthly"].includes(recurrenceKind)) {
    return "Invalid recurrence type.";
  }

  if (recurrenceKind !== "none") {
    const endKind = input.recurrence_end_kind || "semester_end";
    if (!["semester_end", "date", "never"].includes(endKind)) {
      return "Invalid recurrence end condition.";
    }
    if (endKind === "date") {
      if (!input.recurrence_until || !isDateOnly(input.recurrence_until)) {
        return "A valid end date is required for date-based recurrence.";
      }
      if (input.recurrence_until < input.due_date) {
        return "Recurrence end date must be on or after the initial due date.";
      }
    }
    if (recurrenceKind === "selected_weekdays") {
      if (!Array.isArray(input.recurrence_weekdays) || input.recurrence_weekdays.length === 0) {
        return "Select at least one weekday for recurrence.";
      }
      for (const w of input.recurrence_weekdays) {
        if (typeof w !== "number" || w < 1 || w > 7) {
          return "Invalid weekday in recurrence.";
        }
      }
    }
    if (recurrenceKind === "every_x_weeks") {
      if (typeof input.recurrence_interval !== "number" || input.recurrence_interval < 1) {
        return "Interval must be 1 or greater.";
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

  const recurrenceKind = input.recurrence_kind || "none";
  const recurrenceEndKind = recurrenceKind === "none" ? "none" : (input.recurrence_end_kind || "semester_end");
  const recurrenceUntil = recurrenceEndKind === "date" ? input.recurrence_until || null : null;
  const recurrenceInterval = recurrenceKind === "every_x_weeks"
    ? Math.max(1, input.recurrence_interval || 1)
    : 1;
  const recurrenceWeekdays = recurrenceKind === "selected_weekdays" && Array.isArray(input.recurrence_weekdays)
    ? [...new Set(input.recurrence_weekdays.filter((w) => w >= 1 && w <= 7))].sort((a, b) => a - b)
    : null;

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
    recurrence_kind: recurrenceKind,
    recurrence_interval: recurrenceInterval,
    recurrence_weekdays: recurrenceWeekdays,
    recurrence_end_kind: recurrenceEndKind,
    recurrence_until: recurrenceUntil,
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

  // Sync URLs and subtasks
  const syncRes = await syncAssignmentUrlsAndSubtasks({
    supabase,
    userId,
    semesterId,
    assignmentId: targetId,
    urls: input.urls,
    subtasks: input.subtasks,
  });

  if (syncRes.error) {
    revalidatePath("/planner");
    return { error: syncRes.error, id: targetId };
  }

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null, id: targetId };
}

async function syncAssignmentUrlsAndSubtasks({
  supabase,
  userId,
  semesterId,
  assignmentId,
  urls,
  subtasks,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  semesterId: string;
  assignmentId: string;
  urls?: AssignmentDraft["urls"];
  subtasks?: AssignmentDraft["subtasks"];
}): Promise<{ error: string | null }> {
  // Sync URLs
  if (urls !== undefined) {
    try {
      const urlsToInsert = (urls || []).map((link, idx) => ({
        id: isId(link.id) ? link.id : crypto.randomUUID(),
        user_id: userId,
        semester_id: semesterId,
        assignment_id: assignmentId,
        url: link.url.trim(),
        label: link.label?.trim() || null,
        position: idx,
      }));

      const { error: delUrlError } = await supabase
        .from("planner_assignment_urls")
        .delete()
        .eq("assignment_id", assignmentId)
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
      return {
        error: "The assignment was saved, but some URLs could not be updated. Please review them.",
      };
    }
  }

  // Sync Subtasks
  if (subtasks !== undefined) {
    try {
      const subtasksToInsert = (subtasks || []).map((task, idx) => ({
        id: isId(task.id) ? task.id : crypto.randomUUID(),
        user_id: userId,
        semester_id: semesterId,
        assignment_id: assignmentId,
        title: task.title.trim(),
        is_done: Boolean(task.is_done),
        due_date: task.due_date && isDateOnly(task.due_date) ? task.due_date : null,
        position: idx,
        updated_at: new Date().toISOString(),
      }));

      const { error: delSubError } = await supabase
        .from("planner_assignment_subtasks")
        .delete()
        .eq("assignment_id", assignmentId)
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
      return {
        error: "The assignment was saved, but some subtasks could not be updated. Please review them.",
      };
    }
  }

  return { error: null };
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

  // Opportunistically clean up queued storage objects for unreferenced attachments
  void processPlannerAttachmentCleanup(context.supabase, context.userId);

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null };
}

export async function toggleAssignmentStatus(
  id: string,
  currentStatus: AssignmentStatus,
  virtualContext?: { parentSeriesId: string; originalDueDate: string }
): Promise<{ error: string | null; status: AssignmentStatus | null }> {
  const nextStatus: AssignmentStatus = currentStatus === "done" ? "not_started" : "done";

  if (virtualContext) {
    const result = await materializeOccurrenceAction({
      seriesId: virtualContext.parentSeriesId,
      originalDueDate: virtualContext.originalDueDate,
      updates: { status: nextStatus },
    });
    if (result.error) return { error: result.error, status: null };
    return { error: null, status: nextStatus };
  }

  const context = await ownedAssignment(id);
  if (!context) return { error: "This assignment is unavailable.", status: null };

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

export async function materializeOccurrenceAction({
  seriesId,
  originalDueDate,
  updates,
}: {
  seriesId: string;
  originalDueDate: string;
  updates: Partial<AssignmentDraft>;
}): Promise<{ error: string | null; id: string | null }> {
  const context = await authenticated();
  if (!isId(seriesId) || !isDateOnly(originalDueDate)) {
    return { error: "Invalid occurrence parameters.", id: null };
  }

  const payload: Record<string, unknown> = {};
  if ("title" in updates) payload.title = updates.title ?? null;
  if ("description" in updates) payload.description = updates.description ?? null;
  if ("planner_course_id" in updates) payload.planner_course_id = updates.planner_course_id ?? null;
  if ("start_date" in updates) payload.start_date = updates.start_date ?? null;
  if ("due_date" in updates) payload.due_date = updates.due_date ?? null;
  if ("due_time" in updates) payload.due_time = updates.due_time ? updates.due_time.slice(0, 5) : null;
  if ("type_kind" in updates) payload.type_kind = updates.type_kind ?? null;
  if ("custom_type_id" in updates) payload.custom_type_id = updates.custom_type_id ?? null;
  if ("status" in updates) payload.status = updates.status ?? null;
  if ("priority" in updates) payload.priority = updates.priority ?? null;

  if ("urls" in updates) payload.urls = updates.urls ?? null;
  if ("subtasks" in updates) payload.subtasks = updates.subtasks ?? null;

  // Transactional RPC execution
  const rpcRes = await context.supabase.rpc("materialize_recurring_assignment_occurrence", {
    p_series_id: seriesId,
    p_original_due_date: originalDueDate,
    p_updates: payload,
  });

  if (rpcRes.error) {
    console.error("materialize_recurring_assignment_occurrence RPC error:", rpcRes.error);
    const code = rpcRes.error.code;
    const msg = rpcRes.error.message || "";
    if (code === "PGRST202" || code === "42883" || msg.includes("function") || msg.includes("not found")) {
      return {
        error: "Database migration required. Please apply the recurring assignments migration to Supabase.",
        id: null,
      };
    }
    return {
      error: rpcRes.error.message || "Could not materialize occurrence.",
      id: null,
    };
  }

  const materializedId = rpcRes.data as string;

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null, id: materializedId };
}

export async function splitSeriesAction({
  seriesId,
  splitDate,
  updates,
}: {
  seriesId: string;
  splitDate: string;
  updates: Partial<AssignmentDraft>;
}): Promise<{ error: string | null; id: string | null }> {
  const context = await authenticated();
  if (!isId(seriesId) || !isDateOnly(splitDate)) {
    return { error: "Invalid split parameters.", id: null };
  }

  const payload: Record<string, unknown> = {};
  if ("title" in updates) payload.title = updates.title ?? null;
  if ("description" in updates) payload.description = updates.description ?? null;
  if ("planner_course_id" in updates) payload.planner_course_id = updates.planner_course_id ?? null;
  if ("start_date" in updates) payload.start_date = updates.start_date ?? null;
  if ("due_date" in updates) payload.due_date = updates.due_date ?? null;
  if ("due_time" in updates) payload.due_time = updates.due_time ? updates.due_time.slice(0, 5) : null;
  if ("type_kind" in updates) payload.type_kind = updates.type_kind ?? null;
  if ("custom_type_id" in updates) payload.custom_type_id = updates.custom_type_id ?? null;
  if ("status" in updates) payload.status = updates.status ?? null;
  if ("priority" in updates) payload.priority = updates.priority ?? null;
  if ("recurrence_kind" in updates) payload.recurrence_kind = updates.recurrence_kind ?? null;
  if ("recurrence_interval" in updates) {
    const kind = updates.recurrence_kind ?? "every_x_weeks";
    payload.recurrence_interval = kind === "every_x_weeks" ? Math.max(1, updates.recurrence_interval || 1) : 1;
  }
  if ("recurrence_weekdays" in updates) payload.recurrence_weekdays = updates.recurrence_weekdays ?? null;
  if ("recurrence_end_kind" in updates) payload.recurrence_end_kind = updates.recurrence_end_kind ?? null;
  if ("recurrence_until" in updates) payload.recurrence_until = updates.recurrence_until ?? null;
  if ("urls" in updates) payload.urls = updates.urls ?? null;
  if ("subtasks" in updates) payload.subtasks = updates.subtasks ?? null;

  // Transactional RPC execution
  const rpcRes = await context.supabase.rpc("split_recurring_assignment_series", {
    p_series_id: seriesId,
    p_split_date: splitDate,
    p_updates: payload,
  });

  if (rpcRes.error) {
    console.error("split_recurring_assignment_series RPC error:", rpcRes.error);
    const code = rpcRes.error.code;
    const msg = rpcRes.error.message || "";
    if (code === "PGRST202" || code === "42883" || msg.includes("function") || msg.includes("not found")) {
      return {
        error: "Database migration required. Please apply the recurring assignments migration to Supabase.",
        id: null,
      };
    }
    return {
      error: rpcRes.error.message || "Could not split series.",
      id: null,
    };
  }

  const targetSeriesId = rpcRes.data as string;

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null, id: targetSeriesId };
}

export async function updateEntireSeriesAction({
  seriesId,
  updates,
}: {
  seriesId: string;
  semesterId?: string;
  updates: AssignmentDraft;
}): Promise<{ error: string | null; id: string | null }> {
  const invalid = validateAssignmentDraft(updates);
  if (invalid) return { error: invalid, id: null };

  const context = await authenticated();
  if (!isId(seriesId)) {
    return { error: "Invalid series ID.", id: null };
  }

  const payload: Record<string, unknown> = {
    title: updates.title.trim(),
    description: updates.description?.trim() || null,
    planner_course_id: updates.planner_course_id,
    start_date: updates.start_date || null,
    due_date: updates.due_date,
    due_time: updates.due_time ? updates.due_time.slice(0, 5) : null,
    type_kind: updates.type_kind,
    custom_type_id: updates.type_kind === "custom" ? updates.custom_type_id : null,
    priority: updates.priority,
    recurrence_kind: updates.recurrence_kind,
    recurrence_interval: updates.recurrence_interval,
    recurrence_weekdays: updates.recurrence_weekdays,
    recurrence_end_kind: updates.recurrence_end_kind,
    recurrence_until: updates.recurrence_until,
    urls: updates.urls,
    subtasks: updates.subtasks,
  };

  // Transactional RPC execution
  const rpcRes = await context.supabase.rpc("update_recurring_assignment_series", {
    p_series_id: seriesId,
    p_updates: payload,
  });

  if (rpcRes.error) {
    console.error("update_recurring_assignment_series RPC error:", rpcRes.error);
    const code = rpcRes.error.code;
    const msg = rpcRes.error.message || "";
    if (code === "PGRST202" || code === "42883" || msg.includes("function") || msg.includes("not found")) {
      return {
        error: "Database migration required. Please apply the recurring assignments stabilization migration to Supabase.",
        id: null,
      };
    }
    return {
      error: rpcRes.error.message || "Could not update recurring series.",
      id: null,
    };
  }

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null, id: rpcRes.data as string };
}

export async function cancelOccurrenceAction({
  seriesId,
  originalDueDate,
}: {
  seriesId: string;
  originalDueDate: string;
}): Promise<{ error: string | null }> {
  const context = await authenticated();
  if (!isId(seriesId) || !isDateOnly(originalDueDate)) {
    return { error: "Invalid occurrence parameters." };
  }

  // Transactional RPC execution
  const rpcRes = await context.supabase.rpc("cancel_recurring_assignment_occurrence", {
    p_series_id: seriesId,
    p_original_due_date: originalDueDate,
  });

  if (rpcRes.error) {
    console.error("cancel_recurring_assignment_occurrence RPC error:", rpcRes.error);
    const code = rpcRes.error.code;
    const msg = rpcRes.error.message || "";
    if (code === "PGRST202" || code === "42883" || msg.includes("function") || msg.includes("not found")) {
      return {
        error: "Database migration required. Please apply the recurring assignments migration to Supabase.",
      };
    }
    return {
      error: rpcRes.error.message || "Could not cancel occurrence.",
    };
  }

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null };
}

export async function rescheduleAssignmentAction({
  id,
  isVirtual,
  parentSeriesId,
  originalDueDate,
  dueDate,
  startDate,
}: {
  id: string;
  isVirtual?: boolean;
  parentSeriesId?: string | null;
  originalDueDate?: string | null;
  dueDate: string;
  startDate?: string | null;
}): Promise<{ error: string | null }> {
  if (!isDateOnly(dueDate)) {
    return { error: "Invalid due date." };
  }

  if (isVirtual && parentSeriesId && originalDueDate) {
    const res = await materializeOccurrenceAction({
      seriesId: parentSeriesId,
      originalDueDate,
      updates: {
        due_date: dueDate,
        start_date: startDate || null,
      },
    });
    return { error: res.error };
  }

  const context = await ownedAssignment(id);
  if (!context) return { error: "This assignment is unavailable." };

  const { error } = await context.supabase
    .from("planner_assignments")
    .update({
      due_date: dueDate,
      start_date: startDate || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", context.userId);

  if (error) {
    console.error("Could not reschedule assignment:", error);
    return { error: "Could not reschedule assignment." };
  }

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null };
}

// ==============================================================================
// Planner Attachments
// ==============================================================================

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "sh", "bash", "ps1", "vbs", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "py", "rb", "php", "pl", "cgi", "jar", "war", "ear", "msi", "dll", "com", "scr", "hta",
  "html", "htm", "xhtml", "svg", "xml"
]);

export async function validateAttachmentFile({
  name,
  size,
  type,
}: {
  name: string;
  size: number;
  type?: string;
}): Promise<{ error: string | null; canonicalMime: string | null }> {
  if (!name || !name.trim()) {
    return { error: "File name is required.", canonicalMime: null };
  }
  if (size <= 0) {
    return { error: "File cannot be empty.", canonicalMime: null };
  }
  if (size > MAX_ATTACHMENT_SIZE) {
    return { error: "File exceeds the 20 MB size limit.", canonicalMime: null };
  }

  const parts = name.split(".");
  if (parts.length < 2) {
    return { error: "File must have a valid extension.", canonicalMime: null };
  }
  const ext = parts.pop()!.toLowerCase().trim();

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { error: "Executable and script files are not allowed.", canonicalMime: null };
  }

  const expectedMime = EXTENSION_TO_MIME[ext];
  if (!expectedMime || !ALLOWED_MIME_TYPES.has(expectedMime)) {
    return {
      error: "Unsupported file type. Allowed: PDF, images (JPG/PNG/WebP), Word, PowerPoint, Excel, CSV.",
      canonicalMime: null,
    };
  }

  if (type && type !== "application/octet-stream" && type !== "") {
    if (type !== expectedMime && !ALLOWED_MIME_TYPES.has(type)) {
      return {
        error: "File content type does not match its extension.",
        canonicalMime: null,
      };
    }
  }

  return { error: null, canonicalMime: expectedMime };
}

export async function registerAttachmentAction({
  assignmentId,
  fileName,
  contentType,
  byteSize,
}: {
  assignmentId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
}): Promise<{
  error: string | null;
  data: {
    id: string;
    assignment_id: string;
    semester_id: string;
    storage_path: string;
    file_name: string;
    content_type: string;
    byte_size: number;
    position: number;
  } | null;
}> {
  const context = await authenticated();
  if (!isId(assignmentId)) {
    return { error: "Invalid assignment ID.", data: null };
  }

  const validation = await validateAttachmentFile({
    name: fileName,
    size: byteSize,
    type: contentType,
  });
  if (validation.error || !validation.canonicalMime) {
    return { error: validation.error ?? "Invalid file.", data: null };
  }

  const owned = await ownedAssignment(assignmentId);
  if (!owned) {
    return { error: "Assignment not found or access denied.", data: null };
  }

  const rpcRes = await context.supabase.rpc("register_planner_assignment_attachment", {
    p_assignment_id: assignmentId,
    p_file_name: fileName.trim(),
    p_content_type: validation.canonicalMime,
    p_byte_size: byteSize,
  });

  if (rpcRes.error) {
    console.error("register_planner_assignment_attachment RPC error:", rpcRes.error);
    const code = rpcRes.error.code;
    const msg = rpcRes.error.message || "";
    if (code === "PGRST202" || code === "42883" || msg.includes("function") || msg.includes("not found")) {
      return {
        error: "Database migration required. Please apply the planner attachments migration to Supabase.",
        data: null,
      };
    }
    return {
      error: rpcRes.error.message || "Could not register attachment.",
      data: null,
    };
  }

  return { error: null, data: rpcRes.data };
}

export async function deleteAttachmentAction({
  assignmentId,
  attachmentId,
}: {
  assignmentId: string;
  attachmentId: string;
}): Promise<{ error: string | null }> {
  const context = await authenticated();
  if (!isId(assignmentId) || !isId(attachmentId)) {
    return { error: "Invalid attachment parameters." };
  }

  const owned = await ownedAssignment(assignmentId);
  if (!owned) {
    return { error: "Assignment not found or access denied." };
  }

  const { error } = await context.supabase
    .from("planner_assignment_attachment_refs")
    .delete()
    .eq("assignment_id", assignmentId)
    .eq("attachment_id", attachmentId)
    .eq("user_id", context.userId);

  if (error) {
    console.error("Could not delete attachment reference:", error);
    return { error: "Could not remove the attachment. Please try again." };
  }

  // Opportunistically clean up queued storage objects
  void processPlannerAttachmentCleanup(context.supabase, context.userId);

  revalidatePath("/planner");
  revalidatePath("/");
  return { error: null };
}

export async function getAttachmentSignedUrlAction({
  assignmentId,
  attachmentId,
}: {
  assignmentId: string;
  attachmentId: string;
}): Promise<{ error: string | null; signedUrl: string | null; fileName: string | null }> {
  const context = await authenticated();
  if (!isId(assignmentId) || !isId(attachmentId)) {
    return { error: "Invalid attachment parameters.", signedUrl: null, fileName: null };
  }

  // Verify that this attachment is referenced by this assignment or its series root
  const { data: ref } = await context.supabase
    .from("planner_assignment_attachment_refs")
    .select("attachment_id, assignment_id, attachment:planner_assignment_attachments(storage_path, file_name)")
    .eq("assignment_id", assignmentId)
    .eq("attachment_id", attachmentId)
    .eq("user_id", context.userId)
    .maybeSingle();

  let storagePath: string | null = null;
  let fileName: string | null = null;

  if (ref && ref.attachment) {
    const att = ref.attachment as unknown as { storage_path: string; file_name: string };
    storagePath = att.storage_path;
    fileName = att.file_name;
  } else {
    // If not found directly, check if assignment is an occurrence of a series root
    const owned = await ownedAssignment(assignmentId);
    if (owned && owned.assignment.parent_series_id) {
      const { data: rootRef } = await context.supabase
        .from("planner_assignment_attachment_refs")
        .select("attachment:planner_assignment_attachments(storage_path, file_name)")
        .eq("assignment_id", owned.assignment.parent_series_id)
        .eq("attachment_id", attachmentId)
        .eq("user_id", context.userId)
        .maybeSingle();

      if (rootRef && rootRef.attachment) {
        const att = rootRef.attachment as unknown as { storage_path: string; file_name: string };
        storagePath = att.storage_path;
        fileName = att.file_name;
      }
    }
  }

  if (!storagePath) {
    return { error: "Attachment not found or access denied.", signedUrl: null, fileName: null };
  }

  // Create 5-minute private signed URL
  const { data, error } = await context.supabase.storage
    .from("planner-attachments")
    .createSignedUrl(storagePath, 300);

  if (error || !data?.signedUrl) {
    console.error("Could not create signed URL for attachment:", error);
    return { error: "Could not access private attachment.", signedUrl: null, fileName: null };
  }

  return { error: null, signedUrl: data.signedUrl, fileName };
}

export async function processPlannerAttachmentCleanup(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string
): Promise<void> {
  try {
    const { data: queued, error: qErr } = await supabase
      .from("planner_attachment_cleanup")
      .select("id, storage_path")
      .eq("user_id", userId)
      .order("queued_at", { ascending: true })
      .limit(10);

    if (qErr || !queued || queued.length === 0) return;

    for (const item of queued) {
      const { error: remErr } = await supabase.storage
        .from("planner-attachments")
        .remove([item.storage_path]);

      if (!remErr) {
        await supabase
          .from("planner_attachment_cleanup")
          .delete()
          .eq("id", item.id)
          .eq("user_id", userId);
      } else {
        console.error("Failed to delete queued storage object:", item.storage_path, remErr);
      }
    }
  } catch (err) {
    console.error("Error processing planner attachment cleanup:", err);
  }
}
