import { daysBetween } from "./dates";
import { parseVirtualAssignmentId } from "./recurrence";
import type { AssignmentSubtask, EffectiveAssignment, PlannerAssignment } from "./types";

type VirtualDueSubtask = {
  assignment: EffectiveAssignment;
  subtask: AssignmentSubtask;
  templateSubtaskId: string;
};

export function virtualSubtaskLookaheadDays(
  roots: Pick<PlannerAssignment, "id" | "due_date">[],
  subtasks: Pick<AssignmentSubtask, "assignment_id" | "due_date">[]
): number {
  const rootById = new Map(roots.map((root) => [root.id, root]));
  return subtasks.reduce((max, task) => {
    const root = rootById.get(task.assignment_id);
    return root && task.due_date
      ? Math.max(max, daysBetween(task.due_date, root.due_date))
      : max;
  }, 0);
}

/** Select only effective virtual subtasks; the resolver suppresses materialized occurrences. */
export function selectVirtualDashboardSubtasks(
  assignments: EffectiveAssignment[],
  today: string,
  day3: string
): { next3Days: VirtualDueSubtask[]; overdue: VirtualDueSubtask[] } {
  const next3Days: VirtualDueSubtask[] = [];
  const overdue: VirtualDueSubtask[] = [];
  for (const assignment of assignments) {
    if (!assignment.isVirtual || assignment.status === "done") continue;
    for (const subtask of assignment.subtasks ?? []) {
      if (!subtask.due_date || subtask.is_done || subtask.due_date > day3) continue;
      const source = parseVirtualAssignmentId(subtask.id);
      if (!source || source.occurrenceDate !== assignment.originalOccurrenceDate) continue;
      const selected = { assignment, subtask, templateSubtaskId: source.rootId };
      if (subtask.due_date < today) overdue.push(selected);
      else next3Days.push(selected);
    }
  }
  return { next3Days, overdue };
}
