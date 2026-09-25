"use server";

import { addDays, isDateOnly, localDate } from "@/lib/planner/dates";
import type { AssignmentStatus } from "@/lib/planner/types";
import { createClient } from "@/lib/supabase/server";

export type PlannerSummaryItem = {
  id: string;
  kind: "assignment" | "subtask";
  title: string;
  assignmentId: string;
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
    .select("id, name, archived_at")
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

  // 2. Fetch courses and assignments/subtasks in parallel
  const [
    coursesRes,
    nextAssignmentsRes,
    nextSubtasksRes,
    overdueAssignmentsRes,
    overdueSubtasksRes,
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
      .order("title", { ascending: true })
      .limit(20),
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
      .order("position", { ascending: true })
      .limit(20),
    supabase
      .from("planner_assignments")
      .select("id, semester_id, planner_course_id, title, due_date, due_time, priority, status")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds)
      .neq("status", "done")
      .lt("due_date", today)
      .order("due_date", { ascending: false })
      .order("title", { ascending: true })
      .limit(20),
    supabase
      .from("planner_assignment_subtasks")
      .select("id, semester_id, assignment_id, title, is_done, due_date, position")
      .eq("user_id", userId)
      .in("semester_id", activeSemesterIds)
      .eq("is_done", false)
      .not("due_date", "is", null)
      .lt("due_date", today)
      .order("due_date", { ascending: false })
      .order("position", { ascending: true })
      .limit(20),
  ]);

  if (coursesRes.error) console.error("Failed to load planner courses:", coursesRes.error);
  if (nextAssignmentsRes.error) console.error("Failed to load next assignments:", nextAssignmentsRes.error);
  if (nextSubtasksRes.error) console.error("Failed to load next subtasks:", nextSubtasksRes.error);
  if (overdueAssignmentsRes.error) console.error("Failed to load overdue assignments:", overdueAssignmentsRes.error);
  if (overdueSubtasksRes.error) console.error("Failed to load overdue subtasks:", overdueSubtasksRes.error);

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
    const { data: missingParents } = await supabase
      .from("planner_assignments")
      .select("id, title, planner_course_id, priority, status")
      .eq("user_id", userId)
      .in("id", missingParentIds);
    for (const a of missingParents ?? []) {
      assignmentMap.set(a.id, a);
    }
  }

  // 4. Transform Next 3 Days items
  const nextAssignmentItems: PlannerSummaryItem[] = (nextAssignmentsRes.data ?? []).map((a) => {
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

  const nextSubtaskItems: PlannerSummaryItem[] = [];
  for (const s of rawNextSubtasks) {
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

  const allNext3Days = [...nextAssignmentItems, ...nextSubtaskItems].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
    if (a.dueTime && !b.dueTime) return -1;
    if (!a.dueTime && b.dueTime) return 1;
    return a.title.localeCompare(b.title);
  });

  // 5. Transform Overdue items
  const overdueAssignmentItems: PlannerSummaryItem[] = (overdueAssignmentsRes.data ?? []).map((a) => {
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

  const overdueSubtaskItems: PlannerSummaryItem[] = [];
  for (const s of rawOverdueSubtasks) {
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

  const allOverdue = [...overdueAssignmentItems, ...overdueSubtaskItems].sort((a, b) => {
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
