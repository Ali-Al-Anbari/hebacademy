"use server";

import { revalidatePath } from "next/cache";
import { addDays, isDateOnly, localDate } from "@/lib/planner/dates";
import { selectVirtualDashboardSubtasks, virtualSubtaskLookaheadDays } from "@/lib/planner/dashboard-subtasks";
import { resolveEffectiveAssignments } from "@/lib/planner/recurrence";
import type {
  AssignmentException,
  AssignmentStatus,
  PlannerAssignment,
} from "@/lib/planner/types";
import { createClient } from "@/lib/supabase/server";

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type PlannerSummaryItem = {
  id: string;
  kind: "assignment" | "subtask";
  title: string;
  assignmentId: string;
  isVirtual?: boolean;
  parentSeriesId?: string | null;
  originalDueDate?: string | null;
  templateSubtaskId?: string;
  parentAssignmentTitle?: string;
  courseName?: string | null;
  courseColor?: string | null;
  dueDate: string;
  dueTime?: string | null;
  isImportant?: boolean;
  status: AssignmentStatus;
  isDone: boolean;
};

export type PlannerDashboardSummary = {
  hasSemesters: boolean;
  hasActiveSemesters: boolean;
  next3Days: PlannerSummaryItem[];
  overdue: PlannerSummaryItem[];
  totalNext3DaysCount: number;
  totalOverdueCount: number;
};

export async function completeVirtualDashboardSubtask(input: {
  seriesId: string;
  originalDueDate: string;
  templateSubtaskId: string;
}): Promise<{ error: string | null }> {
  if (!input || !isId(input.seriesId) || !isId(input.templateSubtaskId)
    || !isDateOnly(input.originalDueDate)) {
    return { error: "This recurring subtask is unavailable." };
  }
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) return { error: "Sign in to update this subtask." };
  const userId = auth.claims.sub;
  const [{ data: root, error: rootError }, { data: task, error: taskError }] = await Promise.all([
    supabase.from("planner_assignments").select("id")
      .eq("id", input.seriesId).eq("user_id", userId)
      .is("parent_series_id", null).neq("recurrence_kind", "none").maybeSingle(),
    supabase.from("planner_assignment_subtasks").select("id")
      .eq("id", input.templateSubtaskId).eq("assignment_id", input.seriesId)
      .eq("user_id", userId).maybeSingle(),
  ]);
  if (rootError || taskError || !root || !task) {
    if (rootError || taskError) console.error("Could not verify virtual subtask:", rootError, taskError);
    return { error: "This recurring subtask is unavailable. Refresh and try again." };
  }

  const { error } = await supabase.rpc("complete_planner_virtual_subtask", {
    p_series_id: input.seriesId,
    p_original_due_date: input.originalDueDate,
    p_template_subtask_id: input.templateSubtaskId,
  });
  if (error) {
    console.error("Could not complete virtual subtask:", error);
    return { error: error.code === "23505"
      ? "This occurrence changed. Refresh and try again."
      : "Could not save this subtask. Please try again." };
  }
  revalidatePath("/");
  revalidatePath("/planner");
  return { error: null };
}

export async function getPlannerDashboardSummary(
  browserDate: string
): Promise<{ error: string | null; data: PlannerDashboardSummary | null }> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) {
    return { error: "Unauthorized", data: null };
  }
  const userId = auth.claims.sub;

  const today = isDateOnly(browserDate) ? browserDate : localDate();
  const day3 = addDays(today, 2);

  // 1. Fetch user's semesters to determine active semesters
  const { data: semesters, error: semError } = await supabase
    .from("planner_semesters")
    .select("id, name, start_date, end_date, archived_at")
    .eq("user_id", userId);

  if (semError) {
    console.error("Failed to load planner semesters:", semError);
    return { error: "Could not load planner data.", data: null };
  }

  if (!semesters || semesters.length === 0) {
    return {
      error: null,
      data: {
        hasSemesters: false,
        hasActiveSemesters: false,
        next3Days: [],
        overdue: [],
        totalNext3DaysCount: 0,
        totalOverdueCount: 0,
      },
    };
  }

  const activeSemesters = semesters.filter((s) => !s.archived_at);
  if (activeSemesters.length === 0) {
    return {
      error: null,
      data: {
        hasSemesters: true,
        hasActiveSemesters: false,
        next3Days: [],
        overdue: [],
        totalNext3DaysCount: 0,
        totalOverdueCount: 0,
      },
    };
  }

  const activeSemesterIds = activeSemesters.map((s) => s.id);

  // 2. Fetch courses, assignments/subtasks, and recurring roots in parallel
  const [
    coursesRes,
    nextAssignmentsRes,
    nextSubtasksRes,
    overdueAssignmentsRes,
    overdueSubtasksRes,
    recurringRootsRes,
    materializedOccurrencesRes,
    exceptionsRes,
  ] = await Promise.all([
    supabase
      .from("planner_courses")
      .select("id, name, color")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds),
    supabase
      .from("planner_assignments")
      .select("id, semester_id, planner_course_id, title, due_date, due_time, priority, status")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds)
      .neq("status", "done")
      .gte("due_date", today)
      .lte("due_date", day3)
      .order("due_date", { ascending: true })
      .order("due_time", { ascending: true, nullsFirst: false })
      .order("title", { ascending: true }),
    supabase
      .from("planner_assignment_subtasks")
      .select("id, semester_id, assignment_id, title, is_done, due_date, position")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds)
      .eq("is_done", false)
      .not("due_date", "is", null)
      .gte("due_date", today)
      .lte("due_date", day3)
      .order("due_date", { ascending: true })
      .order("position", { ascending: true }),
    supabase
      .from("planner_assignments")
      .select("id, semester_id, planner_course_id, title, due_date, due_time, priority, status")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds)
      .neq("status", "done")
      .lt("due_date", today)
      .order("due_date", { ascending: false })
      .order("title", { ascending: true }),
    supabase
      .from("planner_assignment_subtasks")
      .select("id, semester_id, assignment_id, title, is_done, due_date, position")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds)
      .eq("is_done", false)
      .not("due_date", "is", null)
      .lt("due_date", today)
      .order("due_date", { ascending: false })
      .order("position", { ascending: true }),
    supabase
      .from("planner_assignments")
      .select("id, semester_id, planner_course_id, parent_series_id, original_due_date, title, description, start_date, due_date, due_time, type_kind, custom_type_id, status, priority, recurrence_kind, recurrence_interval, recurrence_weekdays, recurrence_end_kind, recurrence_until, created_at, updated_at")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds)
      .neq("recurrence_kind", "none"),
    supabase
      .from("planner_assignments")
      .select("id, semester_id, planner_course_id, parent_series_id, original_due_date, title, description, start_date, due_date, due_time, type_kind, custom_type_id, status, priority, recurrence_kind, recurrence_interval, recurrence_weekdays, recurrence_end_kind, recurrence_until, created_at, updated_at")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds)
      .not("parent_series_id", "is", null),
    supabase
      .from("planner_assignment_exceptions")
      .select("id, semester_id, parent_series_id, original_due_date, kind")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds),
  ]);

  const loadErrors = [coursesRes, nextAssignmentsRes, nextSubtasksRes,
    overdueAssignmentsRes, overdueSubtasksRes, recurringRootsRes,
    materializedOccurrencesRes, exceptionsRes].flatMap((result) => result.error ? [result.error] : []);
  if (loadErrors.length) {
    console.error("Failed to load planner dashboard summary:", loadErrors);
    return { error: "Could not load planner data. Please try again.", data: null };
  }

  const courseMap = new Map<string, { id: string; name: string; color: string }>();
  for (const c of coursesRes.data ?? []) {
    courseMap.set(c.id, c);
  }

  // 3. Resolve parent assignments for subtasks
  const rawNextSubtasks = nextSubtasksRes.data ?? [];
  const rawOverdueSubtasks = overdueSubtasksRes.data ?? [];
  const allSubtaskAssignmentIds = [
    ...new Set([
      ...rawNextSubtasks.map((s) => s.assignment_id),
      ...rawOverdueSubtasks.map((s) => s.assignment_id),
    ]),
  ];

  const assignmentMap = new Map<
    string,
    { id: string; title: string; planner_course_id: string | null; priority: string; status: string }
  >();
  for (const a of nextAssignmentsRes.data ?? []) {
    assignmentMap.set(a.id, a);
  }
  for (const a of overdueAssignmentsRes.data ?? []) {
    assignmentMap.set(a.id, a);
  }

  const missingParentIds = allSubtaskAssignmentIds.filter((id) => !assignmentMap.has(id));
  if (missingParentIds.length > 0) {
    const { data: missingParents, error: parentError } = await supabase
      .from("planner_assignments")
      .select("id, title, planner_course_id, priority, status")
      .eq("user_id", userId)
      .in("id", missingParentIds);
    if (parentError) {
      console.error("Failed to load subtask assignments:", parentError);
      return { error: "Could not load planner data. Please try again.", data: null };
    }
    for (const a of missingParents ?? []) {
      assignmentMap.set(a.id, a);
    }
  }

  const allRoots = (recurringRootsRes.data ?? []) as PlannerAssignment[];
  const allMaterialized = (materializedOccurrencesRes.data ?? []) as PlannerAssignment[];
  const allExceptions = (exceptionsRes.data ?? []) as AssignmentException[];

  const rootIdSet = new Set(allRoots.map((r) => r.id));
  const { data: rootSubtasks, error: rootSubtasksError } = rootIdSet.size
    ? await supabase.from("planner_assignment_subtasks")
      .select("id, assignment_id, title, is_done, due_date, position")
      .eq("user_id", userId).in("assignment_id", [...rootIdSet])
    : { data: [], error: null };
  if (rootSubtasksError) {
    console.error("Failed to load recurring subtask templates:", rootSubtasksError);
    return { error: "Could not load planner data. Please try again.", data: null };
  }

  // 4. Transform Next 3 Days items (excluding recurring series roots so only occurrences appear)
  const nextAssignmentItems: PlannerSummaryItem[] = (nextAssignmentsRes.data ?? [])
    .filter((a) => !rootIdSet.has(a.id))
    .map((a) => {
      const course = a.planner_course_id ? courseMap.get(a.planner_course_id) : null;
      return {
        id: a.id,
        kind: "assignment",
        title: a.title,
        assignmentId: a.id,
        courseName: course?.name ?? null,
        courseColor: course?.color ?? null,
        dueDate: a.due_date,
        dueTime: a.due_time,
        isImportant: a.priority === "important",
        status: a.status as AssignmentStatus,
        isDone: false,
      };
    });

  const overdueAssignmentItems: PlannerSummaryItem[] = (overdueAssignmentsRes.data ?? [])
    .filter((a) => !rootIdSet.has(a.id))
    .map((a) => {
      const course = a.planner_course_id ? courseMap.get(a.planner_course_id) : null;
      return {
        id: a.id,
        kind: "assignment",
        title: a.title,
        assignmentId: a.id,
        courseName: course?.name ?? null,
        courseColor: course?.color ?? null,
        dueDate: a.due_date,
        dueTime: a.due_time,
        isImportant: a.priority === "important",
        status: a.status as AssignmentStatus,
        isDone: false,
      };
    });

  const nextVirtualSubtaskItems: PlannerSummaryItem[] = [];
  const overdueVirtualSubtaskItems: PlannerSummaryItem[] = [];

  // Resolve one bounded occurrence window per semester. The end extends past
  // day 3 when a template subtask is due before its assignment occurrence.
  for (const sem of activeSemesters) {
    const semRoots = allRoots.filter((r) => r.semester_id === sem.id);
    const semMaterialized = allMaterialized.filter((m) => m.semester_id === sem.id);
    const semExceptions = allExceptions.filter((e) => e.semester_id === sem.id);
    if (semRoots.length === 0) continue;
    const semRootIds = new Set(semRoots.map((root) => root.id));
    const semRootSubtasks = (rootSubtasks ?? []).filter((task) => semRootIds.has(task.assignment_id));
    const leadDays = virtualSubtaskLookaheadDays(semRoots, semRootSubtasks);
    const rangeStart = semRoots.reduce((start, root) =>
      root.due_date < start ? root.due_date : start, sem.start_date);
    const resolved = resolveEffectiveAssignments({
      assignments: [...semRoots, ...semMaterialized],
      exceptions: semExceptions,
      semester: {
        id: sem.id,
        name: sem.name,
        start_date: sem.start_date,
        end_date: sem.end_date,
        time_zone: "UTC",
        created_at: "",
        archived_at: null,
      },
      rangeStart,
      rangeEnd: addDays(day3, leadDays),
      subtasks: semRootSubtasks,
    });

    for (const a of resolved.assignments) {
      if (!a.isVirtual || a.status === "done") continue;
      const course = a.planner_course_id ? courseMap.get(a.planner_course_id) : null;
      const assignmentItem: PlannerSummaryItem = {
        id: a.id,
        kind: "assignment",
        title: a.title,
        assignmentId: a.id,
        isVirtual: true,
        parentSeriesId: a.seriesRootId ?? a.parent_series_id,
        originalDueDate: a.originalOccurrenceDate ?? a.original_due_date ?? a.due_date,
        courseName: course?.name ?? null,
        courseColor: course?.color ?? null,
        dueDate: a.due_date,
        dueTime: a.due_time,
        isImportant: a.priority === "important",
        status: a.status as AssignmentStatus,
        isDone: false,
      };
      if (a.due_date >= today && a.due_date <= day3) nextAssignmentItems.push(assignmentItem);
      else if (a.due_date < today) overdueAssignmentItems.push(assignmentItem);
    }

    const dueSubtasks = selectVirtualDashboardSubtasks(resolved.assignments, today, day3);
    for (const [bucket, selected] of [
      [nextVirtualSubtaskItems, dueSubtasks.next3Days],
      [overdueVirtualSubtaskItems, dueSubtasks.overdue],
    ] as const) {
      for (const { assignment: a, subtask: task, templateSubtaskId } of selected) {
        const course = a.planner_course_id ? courseMap.get(a.planner_course_id) : null;
        const item: PlannerSummaryItem = {
          id: task.id,
          kind: "subtask",
          title: task.title,
          assignmentId: a.id,
          isVirtual: true,
          parentSeriesId: a.seriesRootId,
          originalDueDate: a.originalOccurrenceDate,
          templateSubtaskId,
          parentAssignmentTitle: a.title,
          courseName: course?.name ?? null,
          courseColor: course?.color ?? null,
          dueDate: task.due_date!,
          dueTime: null,
          isImportant: a.priority === "important",
          status: a.status as AssignmentStatus,
          isDone: false,
        };
        bucket.push(item);
      }
    }
  }

  const nextSubtaskItems: PlannerSummaryItem[] = [];
  for (const s of rawNextSubtasks) {
    if (rootIdSet.has(s.assignment_id)) continue;
    const parent = assignmentMap.get(s.assignment_id);
    if (!parent || parent.status === "done") continue;
    const course = parent.planner_course_id ? courseMap.get(parent.planner_course_id) : null;
    nextSubtaskItems.push({
      id: s.id,
      kind: "subtask",
      title: s.title,
      assignmentId: s.assignment_id,
      parentAssignmentTitle: parent.title,
      courseName: course?.name ?? null,
      courseColor: course?.color ?? null,
      dueDate: s.due_date!,
      dueTime: null,
      isImportant: parent.priority === "important",
      status: (parent.status as AssignmentStatus) || "not_started",
      isDone: false,
    });
  }

  const allNext3Days = [...nextAssignmentItems, ...nextSubtaskItems, ...nextVirtualSubtaskItems].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
    if (a.dueTime && !b.dueTime) return -1;
    if (!a.dueTime && b.dueTime) return 1;
    return a.title.localeCompare(b.title);
  });

  const overdueSubtaskItems: PlannerSummaryItem[] = [];
  for (const s of rawOverdueSubtasks) {
    if (rootIdSet.has(s.assignment_id)) continue;
    const parent = assignmentMap.get(s.assignment_id);
    if (!parent || parent.status === "done") continue;
    const course = parent.planner_course_id ? courseMap.get(parent.planner_course_id) : null;
    overdueSubtaskItems.push({
      id: s.id,
      kind: "subtask",
      title: s.title,
      assignmentId: s.assignment_id,
      parentAssignmentTitle: parent.title,
      courseName: course?.name ?? null,
      courseColor: course?.color ?? null,
      dueDate: s.due_date!,
      dueTime: null,
      isImportant: parent.priority === "important",
      status: (parent.status as AssignmentStatus) || "not_started",
      isDone: false,
    });
  }

  const allOverdue = [...overdueAssignmentItems, ...overdueSubtaskItems, ...overdueVirtualSubtaskItems].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return b.dueDate.localeCompare(a.dueDate);
    return a.title.localeCompare(b.title);
  });

  return {
    error: null,
    data: {
      hasSemesters: true,
      hasActiveSemesters: true,
      next3Days: allNext3Days,
      overdue: allOverdue,
      totalNext3DaysCount: allNext3Days.length,
      totalOverdueCount: allOverdue.length,
    },
  };
}
