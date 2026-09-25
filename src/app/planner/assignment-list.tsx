"use client";

import { useMemo, useRef, useState } from "react";
import {
  Calendar,
  Check,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  displayTime,
  formatDateRange,
  formatShortDate,
  getDatesInRange,
  isAssignmentOverdue,
  meetingOccurrences,
  nextCalendarDay,
  weekdayOf,
  WEEKDAY_SHORT,
} from "@/lib/planner/dates";
import type {
  AssignmentSubtask,
  AssignmentUrl,
  CourseMeeting,
  MeetingException,
  PlannerAssignment,
  PlannerCourse,
  PlannerCustomType,
  Semester,
} from "@/lib/planner/types";
import { toggleAssignmentStatus } from "./assignment-actions";

type FilterStatus = "all" | "upcoming" | "completed" | "overdue" | "important";

type Props = {
  semester: Semester;
  courses: PlannerCourse[];
  meetings?: CourseMeeting[];
  exceptions?: MeetingException[];
  customTypes: PlannerCustomType[];
  assignments: PlannerAssignment[];
  urls?: AssignmentUrl[];
  subtasks?: AssignmentSubtask[];
  today: string;
  onOpenAssignment: (assignment: PlannerAssignment) => void;
  onAddAssignment: (initialDate?: string, initialCourseId?: string | null) => void;
  onStatusChanged: () => void;
};

export function AssignmentListView({
  semester,
  courses,
  meetings = [],
  exceptions = [],
  assignments,
  today,
  onOpenAssignment,
  onAddAssignment,
  onStatusChanged,
}: Props) {
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const todayRowRef = useRef<HTMLTableRowElement | null>(null);

  // Compute set of course meeting dates in semester
  const meetingCourseDates = useMemo(() => {
    if (!meetings.length) return new Set<string>();
    const occurrences = meetingOccurrences(
      semester,
      courses,
      meetings,
      exceptions,
      semester.start_date,
      nextCalendarDay(semester.end_date)
    );
    const set = new Set<string>();
    for (const occ of occurrences) {
      set.add(`${occ.courseId}:${occ.date}`);
    }
    return set;
  }, [semester, courses, meetings, exceptions]);

  // Index assignments by due_date and course_id
  const assignmentsByDateAndCourse = useMemo(() => {
    const map = new Map<string, PlannerAssignment[]>();
    for (const assignment of assignments) {
      const key = `${assignment.due_date}:${assignment.planner_course_id ?? "general"}`;
      const list = map.get(key) ?? [];
      list.push(assignment);
      map.set(key, list);
    }
    return map;
  }, [assignments]);

  // All dates in the semester
  const semesterDates = useMemo(() => {
    return getDatesInRange(semester.start_date, semester.end_date);
  }, [semester.start_date, semester.end_date]);

  // Build spreadsheet date groups
  const dateGroups = useMemo(() => {
    const groups: {
      date: string;
      dayAbbrev: string;
      shortDate: string;
      isToday: boolean;
      courseRows: {
        id: string;
        name: string;
        color?: string;
        meetsToday: boolean;
        isGeneral: boolean;
        assignments: PlannerAssignment[];
      }[];
    }[] = [];

    const activeCourses =
      courseFilter === "all"
        ? courses
        : courseFilter === "general"
          ? []
          : courses.filter((c) => c.id === courseFilter);

    for (const date of semesterDates) {
      const dayNum = weekdayOf(date);
      const dayAbbrev = WEEKDAY_SHORT[dayNum - 1];
      const shortDate = formatShortDate(date);
      const isToday = date === today;

      const courseRows: {
        id: string;
        name: string;
        color?: string;
        meetsToday: boolean;
        isGeneral: boolean;
        assignments: PlannerAssignment[];
      }[] = [];

      // Add regular course rows
      for (const course of activeCourses) {
        const meetsToday = meetingCourseDates.has(`${course.id}:${date}`);
        const cellAssignments = (
          assignmentsByDateAndCourse.get(`${date}:${course.id}`) ?? []
        ).filter((a) => {
          if (statusFilter === "all") return true;
          if (statusFilter === "completed") return a.status === "done";
          if (statusFilter === "upcoming") return a.status !== "done" && a.due_date >= today;
          if (statusFilter === "overdue") return isAssignmentOverdue(a.due_date, a.status, today);
          if (statusFilter === "important") return a.priority === "important";
          return true;
        });

        // In spreadsheet view: if filtering by status, hide course rows that have no matching assignments
        if (statusFilter !== "all" && cellAssignments.length === 0) {
          continue;
        }

        courseRows.push({
          id: course.id,
          name: course.name,
          color: course.color,
          meetsToday,
          isGeneral: false,
          assignments: cellAssignments,
        });
      }

      // Check if uncategorized (general) assignments exist on this date
      const generalAssignments = (
        assignmentsByDateAndCourse.get(`${date}:general`) ?? []
      ).filter((a) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "completed") return a.status === "done";
        if (statusFilter === "upcoming") return a.status !== "done" && a.due_date >= today;
        if (statusFilter === "overdue") return isAssignmentOverdue(a.due_date, a.status, today);
        if (statusFilter === "important") return a.priority === "important";
        return true;
      });

      if (courseFilter === "all" || courseFilter === "general") {
        if (generalAssignments.length > 0) {
          courseRows.push({
            id: "general",
            name: "General",
            meetsToday: false,
            isGeneral: true,
            assignments: generalAssignments,
          });
        }
      }

      // If status filtering is active, skip dates that have no matching rows at all
      if (statusFilter !== "all" && courseRows.length === 0) {
        continue;
      }

      // If no course exists at all in semester, show at least one row per date so table works
      if (courseRows.length === 0 && courses.length === 0) {
        courseRows.push({
          id: "general",
          name: "General",
          meetsToday: false,
          isGeneral: true,
          assignments: generalAssignments,
        });
      }

      if (courseRows.length > 0) {
        groups.push({
          date,
          dayAbbrev,
          shortDate,
          isToday,
          courseRows,
        });
      }
    }

    return groups;
  }, [
    semesterDates,
    courses,
    courseFilter,
    statusFilter,
    assignmentsByDateAndCourse,
    meetingCourseDates,
    today,
  ]);

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

  function scrollToToday() {
    if (todayRowRef.current) {
      todayRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div className="space-y-3" aria-label={`${semester.name} assignments list`}>
      {/* Compact Top Filter & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#dabac4] bg-[#fff9fb] px-3.5 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Jump to Today Button */}
          {semester.start_date <= today && today <= semester.end_date && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={scrollToToday}
              className="h-7 text-xs font-semibold gap-1 px-2.5"
            >
              <Calendar className="size-3 text-brand-ink" />
              Jump to Today
            </Button>
          )}

          {/* Course filter */}
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground font-medium">Class:</span>
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="h-7 rounded border border-input bg-white px-2 text-xs font-medium outline-none focus:border-brand-ink"
              aria-label="Filter assignments by class"
            >
              <option value="all">All classes</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
              <option value="general">General (No class)</option>
            </select>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
              className="h-7 rounded border border-input bg-white px-2 text-xs font-medium outline-none focus:border-brand-ink"
              aria-label="Filter assignments by status"
            >
              <option value="all">All</option>
              <option value="upcoming">Upcoming</option>
              <option value="overdue">Overdue</option>
              <option value="completed">Completed</option>
              <option value="important">Important</option>
            </select>
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          onClick={() => onAddAssignment()}
          className="h-7 text-xs font-semibold gap-1 ml-auto"
        >
          <Plus className="size-3" />
          Add assignment
        </Button>
      </div>

      {/* Authoritative Excel-Style Spreadsheet Table */}
      <div className="planner-sheet-wrap overflow-x-auto rounded-lg border border-[#dabac4] bg-white shadow-xs">
        <table className="planner-sheet-table w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#dabac4] bg-[#fbf0f4] text-[#2A2024] font-semibold sticky top-0 z-10">
              <th className="py-2 px-3 border-r border-[#ebd5dd] w-14 uppercase tracking-wider text-[11px]">
                Day
              </th>
              <th className="py-2 px-3 border-r border-[#ebd5dd] w-24 uppercase tracking-wider text-[11px]">
                Date
              </th>
              <th className="py-2 px-3 border-r border-[#ebd5dd] w-48 uppercase tracking-wider text-[11px]">
                Course
              </th>
              <th className="py-2 px-3 border-r border-[#ebd5dd] w-52 uppercase tracking-wider text-[11px]">
                Topics
              </th>
              <th className="py-2 px-3 uppercase tracking-wider text-[11px]">
                Assignments
              </th>
            </tr>
          </thead>
          <tbody>
            {dateGroups.map((group, groupIdx) => {
              const rowCount = group.courseRows.length;
              const isEvenGroup = groupIdx % 2 === 0;
              const groupBg = isEvenGroup ? "bg-white" : "bg-[#fff9fb]";
              const todayBg = group.isToday ? "bg-[#ffeef3]" : "";

              return group.courseRows.map((courseRow, rowIdx) => {
                const isFirstRowInGroup = rowIdx === 0;
                const isLastRowInGroup = rowIdx === rowCount - 1;
                const rowBorder = isLastRowInGroup
                  ? "border-b-2 border-[#d2aab7]"
                  : "border-b border-[#ebdbe2]";

                return (
                  <tr
                    key={`${group.date}:${courseRow.id}`}
                    ref={group.isToday && isFirstRowInGroup ? todayRowRef : undefined}
                    className={`${group.isToday ? todayBg : groupBg} ${rowBorder} hover:bg-[#fff2f6]/70 transition-colors`}
                  >
                    {/* Day Cell (Rowspan) */}
                    {isFirstRowInGroup && (
                      <td
                        rowSpan={rowCount}
                        className={`py-2 px-3 align-top border-r border-[#ebd5dd] font-semibold text-[#2A2024] ${
                          group.isToday ? "bg-[#ffeef3] text-brand-ink" : ""
                        }`}
                      >
                        {group.dayAbbrev}
                      </td>
                    )}

                    {/* Date Cell (Rowspan) */}
                    {isFirstRowInGroup && (
                      <td
                        rowSpan={rowCount}
                        className={`py-2 px-3 align-top border-r border-[#ebd5dd] text-[#2A2024] whitespace-nowrap ${
                          group.isToday ? "bg-[#ffeef3] font-semibold text-brand-ink" : "font-medium"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{group.shortDate}</span>
                          {group.isToday && (
                            <span className="rounded bg-brand-ink px-1 py-0.2 text-[9px] font-bold text-white uppercase tracking-tight">
                              Today
                            </span>
                          )}
                        </div>
                      </td>
                    )}

                    {/* Course Cell */}
                    <td className="py-2 px-3 align-top border-r border-[#ebd5dd]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {courseRow.color ? (
                          <span
                            className={`size-2 rounded-full shrink-0 ${
                              courseRow.meetsToday ? "opacity-100" : "opacity-35"
                            }`}
                            style={{ backgroundColor: courseRow.color }}
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="size-2 rounded-full shrink-0 bg-muted-foreground/40" />
                        )}
                        <span
                          className={`truncate ${
                            courseRow.meetsToday
                              ? "font-semibold text-ink"
                              : "font-normal text-muted-foreground/75"
                          } ${courseRow.isGeneral ? "italic text-muted-foreground" : ""}`}
                          title={
                            courseRow.meetsToday
                              ? `${courseRow.name} (Meets today)`
                              : courseRow.name
                          }
                        >
                          {courseRow.name}
                        </span>
                      </div>
                    </td>

                    {/* Topics Column (Preserved hook for future course notes/topics) */}
                    <td className="py-2 px-3 align-top border-r border-[#ebd5dd] text-muted-foreground/60 min-w-44">
                      {/* Blank hook for future topics */}
                    </td>

                    {/* Assignments Column */}
                    <td
                      className="py-1.5 px-3 align-top group/cell cursor-pointer"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("button") || target.closest("a")) return;
                        onAddAssignment(group.date, courseRow.isGeneral ? null : courseRow.id);
                      }}
                      title="Click to add assignment"
                    >
                      {courseRow.assignments.length > 0 ? (
                        <div className="space-y-1.5">
                          {courseRow.assignments.map((assignment) => {
                            const isDone = assignment.status === "done";
                            const isImportant = assignment.priority === "important";
                            const isMultiDay = Boolean(
                              assignment.start_date && assignment.start_date !== assignment.due_date
                            );

                            return (
                              <div
                                key={assignment.id}
                                className="flex items-center gap-1.5 group/item"
                              >
                                {/* Checkbox */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleToggleStatus(assignment);
                                  }}
                                  disabled={togglingId === assignment.id}
                                  className={`flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
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

                                {/* Important ! indicator */}
                                {isImportant && (
                                  <span
                                    className="font-bold text-red-600 shrink-0 text-xs select-none"
                                    title="Important"
                                    aria-label="Important"
                                  >
                                    !
                                  </span>
                                )}

                                {/* Assignment Title */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenAssignment(assignment);
                                  }}
                                  className={`text-left font-medium text-ink hover:text-brand-ink hover:underline truncate max-w-sm sm:max-w-md ${
                                    isDone ? "line-through text-muted-foreground opacity-65" : ""
                                  }`}
                                >
                                  {assignment.title}
                                </button>

                                {/* Multi-day range note */}
                                {isMultiDay && (
                                  <span className="text-[10px] text-muted-foreground shrink-0 font-normal">
                                    ({formatDateRange(assignment.start_date, assignment.due_date)})
                                  </span>
                                )}

                                {/* Optional due time */}
                                {assignment.due_time && !isMultiDay && (
                                  <span className="text-[10px] text-muted-foreground shrink-0 font-normal">
                                    {displayTime(assignment.due_time)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center min-h-[1.5rem]">
                          <span className="opacity-0 group-hover/cell:opacity-100 text-[11px] text-muted-foreground hover:text-brand-ink flex items-center gap-1 font-medium transition-opacity">
                            <Plus className="size-3" />
                            Add assignment
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
