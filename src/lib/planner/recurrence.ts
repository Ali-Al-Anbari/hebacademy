import {
  addDays,
  daysBetween,
  daysInMonth,
  isDateOnly,
  weekdayOf,
} from "./dates";
import type {
  AssignmentException,
  AssignmentSubtask,
  AssignmentUrl,
  EffectiveAssignment,
  PlannerAssignment,
  Semester,
} from "./types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Safely parses a virtual occurrence composite ID in format `${rootUuid}:${YYYY-MM-DD}`.
 * Also supports legacy "virtual:uuid:date" format.
 * Returns null if the ID is not a valid virtual occurrence format.
 */
export function parseVirtualAssignmentId(id: string): { rootId: string; occurrenceDate: string } | null {
  if (typeof id !== "string") return null;
  let cleanId = id;
  if (cleanId.startsWith("virtual:")) {
    cleanId = cleanId.slice(8);
  }
  const parts = cleanId.split(":");
  if (parts.length === 2 && UUID_REGEX.test(parts[0]) && isDateOnly(parts[1])) {
    return { rootId: parts[0], occurrenceDate: parts[1] };
  }
  return null;
}

export type GeneratedOccurrenceDate = {
  dueDate: string;
  startDate: string | null;
  originalDueDate: string;
};

/**
 * Pure, deterministic recurrence occurrence generator.
 * Operates purely on calendar-date strings (YYYY-MM-DD) without UTC timezone conversion.
 */
export function generateAssignmentOccurrences(
  series: Pick<
    PlannerAssignment,
    | "due_date"
    | "start_date"
    | "recurrence_kind"
    | "recurrence_interval"
    | "recurrence_weekdays"
    | "recurrence_end_kind"
    | "recurrence_until"
  >,
  semester: Pick<Semester, "start_date" | "end_date">,
  rangeStart: string,
  rangeEnd: string
): GeneratedOccurrenceDate[] {
  if (series.recurrence_kind === "none") {
    if (series.due_date >= rangeStart && series.due_date <= rangeEnd) {
      return [
        {
          dueDate: series.due_date,
          startDate: series.start_date,
          originalDueDate: series.due_date,
        },
      ];
    }
    return [];
  }

  const multiDaySpan =
    series.start_date && series.due_date >= series.start_date
      ? daysBetween(series.start_date, series.due_date)
      : 0;

  // Recurrence rule bounds
  const seriesStart = series.due_date;
  let hardEnd = semester.end_date;

  if (series.recurrence_end_kind === "date" && series.recurrence_until) {
    if (series.recurrence_until < hardEnd) {
      hardEnd = series.recurrence_until;
    }
  }

  // If the entire series occurs after rangeEnd or before rangeStart, or end < start
  if (seriesStart > rangeEnd || seriesStart > hardEnd) {
    return [];
  }

  const occurrences: GeneratedOccurrenceDate[] = [];

  const addCandidate = (dateStr: string) => {
    if (dateStr < seriesStart) return;
    if (dateStr > hardEnd) return;
    if (dateStr < rangeStart || dateStr > rangeEnd) return;

    occurrences.push({
      dueDate: dateStr,
      startDate: multiDaySpan > 0 ? addDays(dateStr, -multiDaySpan) : null,
      originalDueDate: dateStr,
    });
  };

  switch (series.recurrence_kind) {
    case "daily": {
      const interval = Math.max(1, series.recurrence_interval || 1);
      let curr = seriesStart;
      // Fast forward to near rangeStart if possible
      if (curr < rangeStart) {
        const diff = daysBetween(curr, rangeStart);
        const steps = Math.floor(diff / interval);
        if (steps > 0) {
          curr = addDays(curr, steps * interval);
        }
      }
      while (curr <= hardEnd && curr <= rangeEnd) {
        addCandidate(curr);
        curr = addDays(curr, interval);
      }
      break;
    }

    case "weekly": {
      const interval = 7;
      let curr = seriesStart;
      if (curr < rangeStart) {
        const diff = daysBetween(curr, rangeStart);
        const steps = Math.floor(diff / interval);
        if (steps > 0) {
          curr = addDays(curr, steps * interval);
        }
      }
      while (curr <= hardEnd && curr <= rangeEnd) {
        addCandidate(curr);
        curr = addDays(curr, interval);
      }
      break;
    }

    case "every_x_weeks": {
      const weeks = Math.max(1, series.recurrence_interval || 1);
      const interval = weeks * 7;
      let curr = seriesStart;
      if (curr < rangeStart) {
        const diff = daysBetween(curr, rangeStart);
        const steps = Math.floor(diff / interval);
        if (steps > 0) {
          curr = addDays(curr, steps * interval);
        }
      }
      while (curr <= hardEnd && curr <= rangeEnd) {
        addCandidate(curr);
        curr = addDays(curr, interval);
      }
      break;
    }

    case "selected_weekdays": {
      const rawWeekdays = series.recurrence_weekdays || [];
      const weekdaysSet = new Set(
        rawWeekdays.filter((w) => typeof w === "number" && w >= 1 && w <= 7)
      );
      if (weekdaysSet.size === 0) {
        weekdaysSet.add(weekdayOf(seriesStart));
      }

      let curr = seriesStart;
      if (curr < rangeStart) {
        curr = rangeStart;
      }
      const last = hardEnd < rangeEnd ? hardEnd : rangeEnd;
      while (curr <= last) {
        if (weekdaysSet.has(weekdayOf(curr))) {
          addCandidate(curr);
        }
        curr = addDays(curr, 1);
      }
      break;
    }

    case "monthly": {
      // Monthly recurrence on the exact same calendar day number.
      // If a month does not have that day number (e.g. Jan 31 -> Feb 28), it is SKIPPED without clamping.
      const [, , anchorDayStr] = seriesStart.split("-");
      const anchorDay = Number(anchorDayStr);
      let [year, month] = seriesStart.split("-").map(Number);
      const interval = Math.max(1, series.recurrence_interval || 1);

      // Search up to the month of the last boundary
      const [endYear, endMonth] = (hardEnd < rangeEnd ? hardEnd : rangeEnd)
        .split("-")
        .map(Number);

      while (
        year < endYear ||
        (year === endYear && month <= endMonth)
      ) {
        const dim = daysInMonth(year, month);
        if (anchorDay <= dim) {
          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(anchorDay).padStart(2, "0")}`;
          addCandidate(dateStr);
        }
        // Advance month
        month += interval;
        while (month > 12) {
          month -= 12;
          year += 1;
        }
      }
      break;
    }

    default:
      break;
  }

  return occurrences.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/**
 * Merges one-time assignments, materialized occurrences, and generated virtual occurrences
 * for the requested range, applying cancellations and overrides deterministically.
 */
export function resolveEffectiveAssignments({
  assignments,
  exceptions = [],
  semester,
  rangeStart,
  rangeEnd,
  urls = [],
  subtasks = [],
}: {
  assignments: PlannerAssignment[];
  exceptions?: AssignmentException[];
  semester: Semester;
  rangeStart: string;
  rangeEnd: string;
  urls?: AssignmentUrl[];
  subtasks?: AssignmentSubtask[];
}): {
  assignments: EffectiveAssignment[];
  urls: AssignmentUrl[];
  subtasks: AssignmentSubtask[];
} {
  const resultAssignments: EffectiveAssignment[] = [];
  const resultUrls: AssignmentUrl[] = [...urls];
  const resultSubtasks: AssignmentSubtask[] = [...subtasks];

  // Index cancellations: Map<`${parent_series_id}:${original_due_date}`, true>
  const cancelledSet = new Set<string>();
  for (const ex of exceptions) {
    if (ex.kind === "cancelled") {
      cancelledSet.add(`${ex.parent_series_id}:${ex.original_due_date}`);
    }
  }

  // Index materialized occurrences: Map<`${parent_series_id}:${original_due_date}`, PlannerAssignment>
  const materializedMap = new Map<string, PlannerAssignment>();
  for (const a of assignments) {
    if (a.parent_series_id && a.original_due_date) {
      materializedMap.set(`${a.parent_series_id}:${a.original_due_date}`, a);
    }
  }

  // Maps for root URLs and subtasks
  const urlsByAssignmentId = new Map<string, AssignmentUrl[]>();
  for (const u of urls) {
    const list = urlsByAssignmentId.get(u.assignment_id) || [];
    list.push(u);
    urlsByAssignmentId.set(u.assignment_id, list);
  }

  const subtasksByAssignmentId = new Map<string, AssignmentSubtask[]>();
  for (const s of subtasks) {
    const list = subtasksByAssignmentId.get(s.assignment_id) || [];
    list.push(s);
    subtasksByAssignmentId.set(s.assignment_id, list);
  }

  // 1. Process non-recurring assignments and materialized occurrences
  for (const a of assignments) {
    // If it's a recurring series root, it spawns virtual occurrences below instead of rendering directly
    if (!a.parent_series_id && a.recurrence_kind !== "none") {
      continue;
    }

    // Include if within or overlapping range
    const start = a.start_date || a.due_date;
    const end = a.due_date;
    if (end >= rangeStart && start <= rangeEnd) {
      const isOcc = Boolean(a.parent_series_id);
      resultAssignments.push({
        ...a,
        isVirtual: false,
        isOccurrence: isOcc,
        seriesRootId: a.parent_series_id || undefined,
        originalOccurrenceDate: a.original_due_date || undefined,
        originalDueDate: a.original_due_date || a.due_date,
        urls: urlsByAssignmentId.get(a.id) || [],
        subtasks: subtasksByAssignmentId.get(a.id) || [],
      });
    }
  }

  // 2. Expand recurring series roots into virtual occurrences
  const seriesRoots = assignments.filter(
    (a) => !a.parent_series_id && a.recurrence_kind !== "none"
  );

  for (const root of seriesRoots) {
    const occurrences = generateAssignmentOccurrences(
      root,
      semester,
      rangeStart,
      rangeEnd
    );

    const rootUrls = urlsByAssignmentId.get(root.id) || [];
    const rootSubtasks = subtasksByAssignmentId.get(root.id) || [];

    for (const occ of occurrences) {
      const key = `${root.id}:${occ.originalDueDate}`;

      // Suppress if cancelled
      if (cancelledSet.has(key)) {
        continue;
      }

      // Suppress if already materialized (the materialized row is handled above)
      if (materializedMap.has(key)) {
        continue;
      }

      const virtualId = `${root.id}:${occ.originalDueDate}`;

      // Synthesize virtual URLs and subtasks with shifted due dates
      const synthesizedUrls: AssignmentUrl[] = [];
      for (const u of rootUrls) {
        const synUrl: AssignmentUrl = {
          ...u,
          id: `${u.id}:${occ.originalDueDate}`,
          assignment_id: virtualId,
        };
        synthesizedUrls.push(synUrl);
        resultUrls.push(synUrl);
      }

      const synthesizedSubtasks: AssignmentSubtask[] = [];
      const offsetDays = daysBetween(root.due_date, occ.dueDate);
      for (const s of rootSubtasks) {
        const synSubtask: AssignmentSubtask = {
          ...s,
          id: `${s.id}:${occ.originalDueDate}`,
          assignment_id: virtualId,
          is_done: false,
          due_date: s.due_date ? addDays(s.due_date, offsetDays) : null,
        };
        synthesizedSubtasks.push(synSubtask);
        resultSubtasks.push(synSubtask);
      }

      const virtualAssignment: EffectiveAssignment = {
        ...root,
        id: virtualId,
        parent_series_id: root.id,
        original_due_date: occ.originalDueDate,
        originalDueDate: occ.originalDueDate,
        originalOccurrenceDate: occ.originalDueDate,
        isVirtual: true,
        isOccurrence: true,
        seriesRootId: root.id,
        virtualOccurrenceDate: occ.dueDate,
        due_date: occ.dueDate,
        start_date: occ.startDate,
        status: "not_started",
        urls: synthesizedUrls,
        subtasks: synthesizedSubtasks,
      };

      resultAssignments.push(virtualAssignment);
    }
  }

  // Sort assignments by due_date asc, due_time asc, title asc
  resultAssignments.sort((a, b) => {
    if (a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
    if (a.due_time && !b.due_time) return -1;
    if (!a.due_time && b.due_time) return 1;
    return a.title.localeCompare(b.title);
  });

  return {
    assignments: resultAssignments,
    urls: resultUrls,
    subtasks: resultSubtasks,
  };
}
