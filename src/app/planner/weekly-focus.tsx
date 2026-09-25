"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import {
  addDays,
  formatShortDate,
  formatWeekRange,
  getMondayOfWeek,
} from "@/lib/planner/dates";
import type {
  PlannerAssignment,
  PlannerCourse,
  PlannerWeeklyFocusItem,
  Semester,
} from "@/lib/planner/types";
import {
  addFreeformFocusItem,
  deleteWeeklyFocusItem,
  reorderWeeklyFocusItems,
  toggleFreeformFocusItem,
} from "./focus-and-notes-actions";

type Props = {
  semester: Semester;
  weekStart: string;
  onWeekChange: (newWeekStart: string) => void;
  today: string;
  courses: PlannerCourse[];
  assignments: PlannerAssignment[];
  focusItems: PlannerWeeklyFocusItem[];
  onOpenAssignment: (assignment: PlannerAssignment) => void;
  onToggleAssignmentStatus: (assignment: PlannerAssignment) => void;
  onSaved: () => void;
};

export function WeeklyFocus({
  semester,
  weekStart,
  onWeekChange,
  today,
  courses,
  assignments,
  focusItems,
  onOpenAssignment,
  onToggleAssignmentStatus,
  onSaved,
}: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const assignmentById = useMemo(() => new Map(assignments.map((a) => [a.id, a])), [assignments]);

  const currentWeekMonday = useMemo(() => getMondayOfWeek(today), [today]);
  const isCurrentWeek = weekStart === currentWeekMonday;

  // Filter items for current semester and selected week
  const weekItems = useMemo(() => {
    return focusItems
      .filter((item) => item.semester_id === semester.id && item.week_start === weekStart)
      .sort((a, b) => a.position - b.position);
  }, [focusItems, semester.id, weekStart]);

  const incompleteCount = useMemo(() => {
    return weekItems.filter((item) => {
      if (item.assignment_id) {
        const assignment = assignmentById.get(item.assignment_id);
        return assignment ? assignment.status !== "done" : false;
      }
      return !item.is_done;
    }).length;
  }, [weekItems, assignmentById]);

  async function handleAddFreeform(e: FormEvent) {
    e.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await addFreeformFocusItem({
        semesterId: semester.id,
        weekStart,
        title: trimmed,
      });
      if (res.error) {
        alert(res.error);
      } else {
        setNewTitle("");
        onSaved();
      }
    } catch (err) {
      console.error("Failed to add focus item:", err);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleFreeform(item: PlannerWeeklyFocusItem) {
    if (togglingId) return;
    setTogglingId(item.id);
    try {
      await toggleFreeformFocusItem(item.id, item.is_done);
      onSaved();
    } catch (err) {
      console.error("Failed to toggle focus item:", err);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await deleteWeeklyFocusItem(itemId);
      if (res.error) {
        alert(res.error);
      } else {
        onSaved();
      }
    } catch (err) {
      console.error("Failed to remove focus item:", err);
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveItem(index: number, direction: "up" | "down") {
    if (busy) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= weekItems.length) return;

    const newOrder = [...weekItems];
    const [moved] = newOrder.splice(index, 1);
    newOrder.splice(targetIndex, 0, moved);

    setBusy(true);
    try {
      const res = await reorderWeeklyFocusItems({
        semesterId: semester.id,
        weekStart,
        orderedIds: newOrder.map((it) => it.id),
      });
      if (res.error) {
        alert(res.error);
      } else {
        onSaved();
      }
    } catch (err) {
      console.error("Failed to reorder focus items:", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="planner-weekly-focus rounded-xl border border-[#dabac4] bg-[#fffdfd] p-3.5 shadow-xs flex flex-col gap-3"
      aria-label="Weekly Focus checklist"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-1 border-b border-[#ebd5dd] pb-2.5">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-bold text-[#2A2024] tracking-tight">Weekly Focus</h2>
            {incompleteCount > 0 && (
              <span className="rounded-full bg-brand-ink/10 px-1.5 py-0.2 text-[10px] font-bold text-brand-ink">
                {incompleteCount}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Keep your key priorities in view.</p>
        </div>

        {!isCurrentWeek && (
          <button
            type="button"
            onClick={() => onWeekChange(currentWeekMonday)}
            className="rounded bg-[#fbf0f4] hover:bg-brand-ink/10 px-2 py-0.5 text-[10px] font-semibold text-brand-ink transition-colors"
            title="Jump to current week"
          >
            This week
          </button>
        )}
      </div>

      {/* Week Navigator */}
      <div className="flex items-center justify-between rounded-lg bg-[#fbf0f4] px-2 py-1 text-xs">
        <button
          type="button"
          onClick={() => onWeekChange(addDays(weekStart, -7))}
          className="flex size-6 items-center justify-center rounded hover:bg-white text-muted-foreground hover:text-brand-ink transition-colors"
          title="Previous week"
          aria-label="Previous week"
        >
          <ChevronLeft className="size-4" />
        </button>

        <span className="font-semibold text-[#2A2024] text-[11px] select-none">
          {formatWeekRange(weekStart)}
        </span>

        <button
          type="button"
          onClick={() => onWeekChange(addDays(weekStart, 7))}
          className="flex size-6 items-center justify-center rounded hover:bg-white text-muted-foreground hover:text-brand-ink transition-colors"
          title="Next week"
          aria-label="Next week"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Focus Items List */}
      <div className="space-y-1.5 flex-1 min-h-[5rem]">
        {weekItems.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <p>Nothing planned for this week yet.</p>
          </div>
        ) : (
          weekItems.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === weekItems.length - 1;

            if (item.assignment_id) {
              // Pinned Assignment
              const assignment = assignmentById.get(item.assignment_id);
              if (!assignment) return null;

              const course = assignment.planner_course_id
                ? courseById.get(assignment.planner_course_id)
                : null;
              const isDone = assignment.status === "done";
              const isImportant = assignment.priority === "important";

              return (
                <div
                  key={item.id}
                  className={`group/focus flex items-start gap-1.5 rounded-md border p-1.5 text-xs transition-colors ${
                    isDone
                      ? "border-[#ebd5dd] bg-[#fbf5f7] opacity-65"
                      : "border-[#edd8e0] bg-white hover:border-brand-ink/40 shadow-xs"
                  }`}
                >
                  {/* Completion checkbox: updates assignment directly */}
                  <button
                    type="button"
                    onClick={() => onToggleAssignmentStatus(assignment)}
                    className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                      isDone
                        ? "border-brand-ink bg-brand-ink text-white"
                        : "border-input bg-white hover:border-brand-ink"
                    }`}
                    aria-label={
                      isDone
                        ? `Mark "${assignment.title}" as not started`
                        : `Mark "${assignment.title}" as done`
                    }
                  >
                    {isDone && <Check className="size-2.5 stroke-[3]" />}
                  </button>

                  {/* Title and metadata */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      {isImportant && (
                        <span
                          className="font-bold text-red-600 shrink-0 text-xs select-none"
                          title="Important"
                          aria-label="Important"
                        >
                          !
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenAssignment(assignment)}
                        className={`text-left font-medium text-ink hover:text-brand-ink hover:underline truncate ${
                          isDone ? "line-through text-muted-foreground" : ""
                        }`}
                        title={assignment.title}
                      >
                        {assignment.title}
                      </button>
                    </div>

                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {course && (
                        <span className="flex items-center gap-1 truncate max-w-[8rem]">
                          <span
                            className="size-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: course.color }}
                          />
                          <span className="truncate">{course.name}</span>
                        </span>
                      )}
                      <span>·</span>
                      <span>Due {formatShortDate(assignment.due_date)}</span>
                    </div>
                  </div>

                  {/* Pin badge / Actions */}
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/focus:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleMoveItem(index, "up")}
                      disabled={isFirst || busy}
                      className="p-0.5 text-muted-foreground hover:text-brand-ink disabled:opacity-20"
                      title="Move up"
                      aria-label="Move up"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveItem(index, "down")}
                      disabled={isLast || busy}
                      className="p-0.5 text-muted-foreground hover:text-brand-ink disabled:opacity-20"
                      title="Move down"
                      aria-label="Move down"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      disabled={busy}
                      className="p-0.5 text-muted-foreground hover:text-red-600 rounded"
                      title="Remove pin from Weekly Focus (assignment remains intact)"
                      aria-label="Remove pin from Weekly Focus"
                    >
                      <PinOff className="size-3" />
                    </button>
                  </div>
                </div>
              );
            }

            // Freeform checklist item
            return (
              <div
                key={item.id}
                className={`group/focus flex items-start gap-1.5 rounded-md border p-1.5 text-xs transition-colors ${
                  item.is_done
                    ? "border-[#ebd5dd] bg-[#fbf5f7] opacity-65"
                    : "border-[#edd8e0] bg-white hover:border-brand-ink/40 shadow-xs"
                }`}
              >
                {/* Checkbox */}
                <button
                  type="button"
                  onClick={() => handleToggleFreeform(item)}
                  disabled={togglingId === item.id}
                  className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                    item.is_done
                      ? "border-brand-ink bg-brand-ink text-white"
                      : "border-input bg-white hover:border-brand-ink"
                  }`}
                  aria-label={
                    item.is_done
                      ? `Mark "${item.title}" incomplete`
                      : `Mark "${item.title}" complete`
                  }
                >
                  {item.is_done && <Check className="size-2.5 stroke-[3]" />}
                </button>

                {/* Text */}
                <span
                  className={`min-w-0 flex-1 break-words ${
                    item.is_done ? "line-through text-muted-foreground" : "text-ink font-medium"
                  }`}
                >
                  {item.title}
                </span>

                {/* Reorder and Delete Actions */}
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/focus:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleMoveItem(index, "up")}
                    disabled={isFirst || busy}
                    className="p-0.5 text-muted-foreground hover:text-brand-ink disabled:opacity-20"
                    title="Move up"
                    aria-label="Move up"
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveItem(index, "down")}
                    disabled={isLast || busy}
                    className="p-0.5 text-muted-foreground hover:text-brand-ink disabled:opacity-20"
                    title="Move down"
                    aria-label="Move down"
                  >
                    <ArrowDown className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteItem(item.id)}
                    disabled={busy}
                    className="p-0.5 text-muted-foreground hover:text-red-600 rounded"
                    title="Delete focus item"
                    aria-label="Delete focus item"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Freeform Focus Item Input */}
      <form onSubmit={handleAddFreeform} className="flex items-center gap-1.5 pt-1 border-t border-[#ebd5dd]">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a focus item..."
          disabled={busy}
          className="h-7 w-full rounded border border-input bg-white px-2 text-xs outline-none focus:border-brand-ink"
        />
        <button
          type="submit"
          disabled={busy || !newTitle.trim()}
          className="flex size-7 shrink-0 items-center justify-center rounded bg-brand-ink text-white hover:bg-brand-ink/90 disabled:opacity-50 transition-colors"
          title="Add item"
          aria-label="Add item"
        >
          <Plus className="size-3.5" />
        </button>
      </form>
    </section>
  );
}
