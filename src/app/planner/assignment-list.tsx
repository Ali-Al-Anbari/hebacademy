"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  Check,
  Clock,
  Link as LinkIcon,
  ListTodo,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { displayTime, formatDateRange, isAssignmentOverdue } from "@/lib/planner/dates";
import {
  ASSIGNMENT_TYPE_LABELS,
  BUILTIN_ASSIGNMENT_TYPES,
  type AssignmentSubtask,
  type AssignmentUrl,
  type BuiltinAssignmentType,
  type PlannerAssignment,
  type PlannerCourse,
  type PlannerCustomType,
  type Semester,
} from "@/lib/planner/types";
import { toggleAssignmentStatus } from "./assignment-actions";

type FilterStatus = "all" | "upcoming" | "completed" | "overdue" | "important";

type Props = {
  semester: Semester;
  courses: PlannerCourse[];
  customTypes: PlannerCustomType[];
  assignments: PlannerAssignment[];
  urls: AssignmentUrl[];
  subtasks: AssignmentSubtask[];
  today: string;
  onOpenAssignment: (assignment: PlannerAssignment) => void;
  onAddAssignment: () => void;
  onStatusChanged: () => void;
};

export function AssignmentListView({
  semester,
  courses,
  customTypes,
  assignments,
  urls,
  subtasks,
  today,
  onOpenAssignment,
  onAddAssignment,
  onStatusChanged,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const customTypeMap = useMemo(() => new Map(customTypes.map((t) => [t.id, t.name])), [customTypes]);

  const subtasksByAssignment = useMemo(() => {
    const map = new Map<string, AssignmentSubtask[]>();
    for (const sub of subtasks) {
      const list = map.get(sub.assignment_id) ?? [];
      list.push(sub);
      map.set(sub.assignment_id, list);
    }
    return map;
  }, [subtasks]);

  const urlsByAssignment = useMemo(() => {
    const map = new Map<string, AssignmentUrl[]>();
    for (const url of urls) {
      const list = map.get(url.assignment_id) ?? [];
      list.push(url);
      map.set(url.assignment_id, list);
    }
    return map;
  }, [urls]);

  // Counts for filter tabs
  const counts = useMemo(() => {
    let upcoming = 0;
    let completed = 0;
    let overdue = 0;
    let important = 0;

    for (const a of assignments) {
      if (a.status === "done") {
        completed++;
      } else {
        if (a.due_date < today) {
          overdue++;
        } else {
          upcoming++;
        }
      }
      if (a.priority === "important") {
        important++;
      }
    }

    return { all: assignments.length, upcoming, completed, overdue, important };
  }, [assignments, today]);

  // Filtered and sorted assignments
  const filteredAssignments = useMemo(() => {
    return assignments
      .filter((assignment) => {
        // Status tab filter
        if (statusFilter === "upcoming") {
          if (assignment.status === "done" || assignment.due_date < today) return false;
        } else if (statusFilter === "completed") {
          if (assignment.status !== "done") return false;
        } else if (statusFilter === "overdue") {
          if (!isAssignmentOverdue(assignment.due_date, assignment.status, today)) return false;
        } else if (statusFilter === "important") {
          if (assignment.priority !== "important") return false;
        }

        // Course filter
        if (courseFilter !== "all") {
          if (courseFilter === "none") {
            if (assignment.planner_course_id !== null) return false;
          } else if (assignment.planner_course_id !== courseFilter) {
            return false;
          }
        }

        // Type filter
        if (typeFilter !== "all") {
          if (typeFilter.startsWith("custom:")) {
            const customId = typeFilter.slice("custom:".length);
            if (assignment.type_kind !== "custom" || assignment.custom_type_id !== customId) return false;
          } else if (assignment.type_kind !== typeFilter) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        // Default ordering specified in PRD & prompt:
        // 1. due date ascending
        // 2. due time where present
        // 3. title
        const dateCompare = a.due_date.localeCompare(b.due_date);
        if (dateCompare !== 0) return dateCompare;

        const aTime = a.due_time || "23:59:59";
        const bTime = b.due_time || "23:59:59";
        const timeCompare = aTime.localeCompare(bTime);
        if (timeCompare !== 0) return timeCompare;

        return a.title.localeCompare(b.title);
      });
  }, [assignments, statusFilter, courseFilter, typeFilter, today]);

  async function handleToggleStatus(assignment: PlannerAssignment) {
    if (togglingId) return;
    setTogglingId(assignment.id);
    try {
      await toggleAssignmentStatus(assignment.id, assignment.status);
      onStatusChanged();
    } catch (err) {
      console.error("Failed to toggle status:", err);
    } finally {
      setTogglingId(null);
    }
  }

  function getTypeLabel(assignment: PlannerAssignment) {
    if (assignment.type_kind === "custom" && assignment.custom_type_id) {
      return customTypeMap.get(assignment.custom_type_id) ?? "Custom";
    }
    return ASSIGNMENT_TYPE_LABELS[assignment.type_kind as BuiltinAssignmentType] ?? assignment.type_kind;
  }

  return (
    <div className="space-y-4" aria-label={`${semester.name} assignments list`}>
      {/* Top Filter Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Assignment status filters">
          {(
            [
              { key: "all", label: "All", count: counts.all },
              { key: "upcoming", label: "Upcoming", count: counts.upcoming },
              { key: "completed", label: "Completed", count: counts.completed },
              { key: "overdue", label: "Overdue", count: counts.overdue },
              { key: "important", label: "Important", count: counts.important },
            ] as const
          ).map((tab) => {
            const isActive = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setStatusFilter(tab.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-brand-ink text-white shadow-xs"
                    : "bg-[#fff2f6] text-ink hover:bg-brand-100"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isActive
                      ? "bg-white/20 text-white"
                      : tab.key === "overdue" && tab.count > 0
                        ? "bg-red-200 text-red-900"
                        : "bg-black/5 text-muted-foreground"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Secondary Select Dropdowns */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Course filter */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground hidden sm:inline">Class:</span>
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-white px-2 text-xs font-medium outline-none focus:border-brand-ink"
              aria-label="Filter assignments by class"
            >
              <option value="all">All classes</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
              <option value="none">Independent (No class)</option>
            </select>
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground hidden sm:inline">Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-white px-2 text-xs font-medium outline-none focus:border-brand-ink"
              aria-label="Filter assignments by type"
            >
              <option value="all">All types</option>
              <optgroup label="Standard Types">
                {BUILTIN_ASSIGNMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ASSIGNMENT_TYPE_LABELS[type as BuiltinAssignmentType]}
                  </option>
                ))}
              </optgroup>
              {customTypes.length > 0 && (
                <optgroup label="Custom Types">
                  {customTypes.map((ct) => (
                    <option key={ct.id} value={`custom:${ct.id}`}>
                      {ct.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Quick Add Button */}
          <Button
            type="button"
            size="sm"
            onClick={onAddAssignment}
            className="h-8 gap-1.5 text-xs font-semibold ml-auto sm:ml-2"
          >
            <Plus className="size-3.5" />
            Add assignment
          </Button>
        </div>
      </div>

      {/* Assignment List Table / Rows */}
      {filteredAssignments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-white/70 p-12 text-center">
          <ListTodo className="mx-auto size-10 text-muted-foreground/60 mb-2" />
          <h3 className="font-heading text-base font-semibold text-ink">No assignments found</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            {assignments.length === 0
              ? "You haven't created any assignments for this semester yet."
              : "No assignments match the selected filters."}
          </p>
          <div className="mt-4">
            <Button type="button" size="sm" onClick={onAddAssignment} className="gap-1.5">
              <Plus className="size-4" />
              Add assignment
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-xs">
          <ul className="divide-y divide-border/60">
            {filteredAssignments.map((assignment) => {
              const course = assignment.planner_course_id
                ? courseMap.get(assignment.planner_course_id)
                : null;
              const isOverdue = isAssignmentOverdue(assignment.due_date, assignment.status, today);
              const isDone = assignment.status === "done";
              const isImportant = assignment.priority === "important";
              const taskSubtasks = subtasksByAssignment.get(assignment.id) ?? [];
              const taskUrls = urlsByAssignment.get(assignment.id) ?? [];
              const completedSubtasks = taskSubtasks.filter((s) => s.is_done).length;

              return (
                <li
                  key={assignment.id}
                  className={`group flex flex-col gap-3 p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                    isDone
                      ? "bg-[#faf6f7]/80 hover:bg-[#f8f0f3]"
                      : isOverdue
                        ? "bg-[#fff7f8] hover:bg-[#ffeff2]"
                        : "hover:bg-[#fff9fb]"
                  }`}
                >
                  {/* Left: Checkbox, Important, Title & Badges */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <button
                      type="button"
                      disabled={togglingId === assignment.id}
                      onClick={() => void handleToggleStatus(assignment)}
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2 transition-all ${
                        isDone
                          ? "border-brand-ink bg-brand-ink text-white"
                          : "border-border hover:border-brand-ink bg-white"
                      }`}
                      aria-label={
                        isDone
                          ? `Mark "${assignment.title}" as not started`
                          : `Mark "${assignment.title}" as done`
                      }
                    >
                      {isDone && <Check className="size-3.5 stroke-[3]" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isImportant && (
                          <span
                            className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-red-600 font-bold text-[11px] text-white"
                            title="Important"
                            aria-label="Important"
                          >
                            !
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => onOpenAssignment(assignment)}
                          className={`text-left font-heading text-sm font-semibold text-ink hover:text-brand-ink hover:underline decoration-brand-ink/50 text-wrap break-words ${
                            isDone ? "line-through text-muted-foreground" : ""
                          }`}
                        >
                          {assignment.title}
                        </button>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {/* Course Badge */}
                        {course ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium"
                            style={{
                              backgroundColor: `${course.color}18`,
                              color: "#2A2024",
                            }}
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: course.color }}
                              aria-hidden="true"
                            />
                            {course.name}
                          </span>
                        ) : (
                          <span className="rounded-md bg-muted/60 px-2 py-0.5 font-medium text-muted-foreground">
                            Independent
                          </span>
                        )}

                        {/* Type Badge */}
                        <span className="rounded-md border border-border/60 bg-white px-2 py-0.5 text-muted-foreground">
                          {getTypeLabel(assignment)}
                        </span>

                        {/* Status Badge */}
                        {assignment.status === "in_progress" && (
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                            In Progress
                          </span>
                        )}
                        {isDone && (
                          <span className="rounded-md bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900">
                            Done
                          </span>
                        )}
                        {isOverdue && (
                          <span className="rounded-md bg-red-100 px-2 py-0.5 font-bold text-red-800">
                            Overdue
                          </span>
                        )}

                        {/* Subtasks Count */}
                        {taskSubtasks.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <ListTodo className="size-3" />
                            {completedSubtasks}/{taskSubtasks.length}
                          </span>
                        )}

                        {/* URLs Count */}
                        {taskUrls.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <LinkIcon className="size-3" />
                            {taskUrls.length} {taskUrls.length === 1 ? "link" : "links"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Date, Time & Edit action */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 text-xs pl-8 sm:pl-0">
                    <div className="text-right">
                      <div
                        className={`flex items-center gap-1 font-semibold ${
                          isOverdue && !isDone
                            ? "text-red-700"
                            : isDone
                              ? "text-muted-foreground"
                              : "text-ink"
                        }`}
                      >
                        <Calendar className="size-3.5" />
                        <span>{formatDateRange(assignment.start_date, assignment.due_date)}</span>
                      </div>

                      {assignment.due_time && (
                        <div className="flex items-center justify-end gap-1 text-muted-foreground mt-0.5">
                          <Clock className="size-3" />
                          <span>{displayTime(assignment.due_time)}</span>
                        </div>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpenAssignment(assignment)}
                      className="text-xs text-brand-ink hover:underline font-semibold"
                    >
                      Edit
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
