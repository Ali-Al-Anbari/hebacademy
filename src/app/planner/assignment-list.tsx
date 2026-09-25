"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  Calendar,
  Check,
  Edit2,
  Pin,
  Plus,
  Trash2,
  X,
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
  PlannerCourseNote,
  PlannerCustomType,
  PlannerWeeklyFocusItem,
  Semester,
} from "@/lib/planner/types";
import { toggleAssignmentStatus } from "./assignment-actions";
import {
  createCourseNote,
  deleteCourseNote,
  toggleCourseNote,
  updateCourseNote,
} from "./focus-and-notes-actions";

type FilterStatus = "all" | "upcoming" | "completed" | "overdue" | "important";

type Props = {
  semester: Semester;
  courses: PlannerCourse[];
  meetings?: CourseMeeting[];
  exceptions?: MeetingException[];
  customTypes: PlannerCustomType[];
  assignments: PlannerAssignment[];
  courseNotes?: PlannerCourseNote[];
  weeklyFocusItems?: PlannerWeeklyFocusItem[];
  activeWeekStart?: string;
  urls?: AssignmentUrl[];
  subtasks?: AssignmentSubtask[];
  today: string;
  onOpenAssignment: (assignment: PlannerAssignment) => void;
  onAddAssignment: (initialDate?: string, initialCourseId?: string | null) => void;
  onTogglePinAssignment?: (assignmentId: string) => void;
  onStatusChanged: () => void;
};

export function AssignmentListView({
  semester,
  courses,
  meetings = [],
  exceptions = [],
  assignments,
  courseNotes = [],
  weeklyFocusItems = [],
  activeWeekStart,
  today,
  onOpenAssignment,
  onAddAssignment,
  onTogglePinAssignment,
  onStatusChanged,
}: Props) {
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Topics / Course Notes state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState<string>("");
  const [addingNoteFor, setAddingNoteFor] = useState<{ date: string; courseId: string } | null>(null);
  const [addingNoteText, setAddingNoteText] = useState<string>("");
  const [togglingNoteId, setTogglingNoteId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState<boolean>(false);

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

  // Index course notes by `${note_date}:${planner_course_id}`
  const notesByDateAndCourse = useMemo(() => {
    const map = new Map<string, PlannerCourseNote[]>();
    for (const note of courseNotes) {
      const key = `${note.note_date}:${note.planner_course_id}`;
      const list = map.get(key) ?? [];
      list.push(note);
      map.set(key, list);
    }
    return map;
  }, [courseNotes]);

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

  async function handleToggleNote(note: PlannerCourseNote) {
    if (togglingNoteId) return;
    setTogglingNoteId(note.id);
    try {
      await toggleCourseNote(note.id, note.is_done);
      onStatusChanged();
    } catch (err) {
      console.error("Failed to toggle note:", err);
    } finally {
      setTogglingNoteId(null);
    }
  }

  async function handleSaveNewNote(e: FormEvent, date: string, courseId: string) {
    e.preventDefault();
    if (savingNote) return;
    const trimmed = addingNoteText.trim();
    if (!trimmed) return;
    setSavingNote(true);
    try {
      const res = await createCourseNote({
        semesterId: semester.id,
        courseId,
        noteDate: date,
        body: trimmed,
      });
      if (res.error) {
        alert(res.error);
      } else {
        setAddingNoteFor(null);
        setAddingNoteText("");
        onStatusChanged();
      }
    } catch (err) {
      console.error("Failed to create note:", err);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleSaveEditedNote(e: FormEvent, noteId: string) {
    e.preventDefault();
    if (savingNote) return;
    const trimmed = editingNoteText.trim();
    if (!trimmed) return;
    setSavingNote(true);
    try {
      const res = await updateCourseNote({ noteId, body: trimmed });
      if (res.error) {
        alert(res.error);
      } else {
        setEditingNoteId(null);
        setEditingNoteText("");
        onStatusChanged();
      }
    } catch (err) {
      console.error("Failed to update note:", err);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteNote(noteId: string) {
    if (savingNote) return;
    setSavingNote(true);
    try {
      const res = await deleteCourseNote(noteId);
      if (res.error) {
        alert(res.error);
      } else {
        if (editingNoteId === noteId) {
          setEditingNoteId(null);
        }
        onStatusChanged();
      }
    } catch (err) {
      console.error("Failed to delete note:", err);
    } finally {
      setSavingNote(false);
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

                    {/* Topics Column */}
                    <td className="py-2 px-3 align-top border-r border-[#ebd5dd] min-w-52 group/topic">
                      {courseRow.isGeneral ? (
                        <span className="text-muted-foreground/40 text-[11px] italic">—</span>
                      ) : (
                        (() => {
                          const cellNotes = notesByDateAndCourse.get(`${group.date}:${courseRow.id}`) ?? [];
                          const isAddingThis = addingNoteFor?.date === group.date && addingNoteFor?.courseId === courseRow.id;

                          return (
                            <div className="space-y-1.5">
                              {cellNotes.map((note) => {
                                const isEditing = editingNoteId === note.id;
                                if (isEditing) {
                                  return (
                                    <form
                                      key={note.id}
                                      onSubmit={(e) => void handleSaveEditedNote(e, note.id)}
                                      className="flex items-center gap-1"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <input
                                        type="text"
                                        value={editingNoteText}
                                        onChange={(e) => setEditingNoteText(e.target.value)}
                                        autoFocus
                                        className="h-6 w-full rounded border border-brand-ink bg-white px-1.5 text-xs outline-none"
                                        placeholder="Topic or note..."
                                      />
                                      <button
                                        type="submit"
                                        disabled={savingNote || !editingNoteText.trim()}
                                        className="flex size-5 shrink-0 items-center justify-center rounded bg-brand-ink text-white hover:bg-brand-ink/90"
                                        title="Save topic"
                                        aria-label="Save topic"
                                      >
                                        <Check className="size-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingNoteId(null)}
                                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                                        title="Cancel"
                                        aria-label="Cancel"
                                      >
                                        <X className="size-3" />
                                      </button>
                                    </form>
                                  );
                                }

                                return (
                                  <div
                                    key={note.id}
                                    className="group/note flex items-start gap-1.5 text-xs"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleNote(note)}
                                      disabled={togglingNoteId === note.id}
                                      className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                                        note.is_done
                                          ? "border-brand-ink bg-brand-ink text-white"
                                          : "border-input bg-white hover:border-brand-ink"
                                      }`}
                                      aria-label={note.is_done ? "Mark topic incomplete" : "Mark topic complete"}
                                    >
                                      {note.is_done && <Check className="size-2.5 stroke-[3]" />}
                                    </button>

                                    <span
                                      className={`min-w-0 flex-1 break-words cursor-pointer hover:text-brand-ink ${
                                        note.is_done ? "line-through text-muted-foreground opacity-65" : "text-ink"
                                      }`}
                                      onClick={() => {
                                        setEditingNoteId(note.id);
                                        setEditingNoteText(note.body);
                                      }}
                                      title="Click to edit topic"
                                    >
                                      {note.body}
                                    </span>

                                    <div className="opacity-0 group-hover/note:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingNoteId(note.id);
                                          setEditingNoteText(note.body);
                                        }}
                                        className="p-0.5 text-muted-foreground hover:text-brand-ink rounded"
                                        title="Edit topic"
                                        aria-label="Edit topic"
                                      >
                                        <Edit2 className="size-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteNote(note.id)}
                                        className="p-0.5 text-muted-foreground hover:text-red-600 rounded"
                                        title="Delete topic"
                                        aria-label="Delete topic"
                                      >
                                        <Trash2 className="size-3" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Form to add note */}
                              {isAddingThis ? (
                                <form
                                  onSubmit={(e) => void handleSaveNewNote(e, group.date, courseRow.id)}
                                  className="flex items-center gap-1 mt-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="text"
                                    value={addingNoteText}
                                    onChange={(e) => setAddingNoteText(e.target.value)}
                                    autoFocus
                                    className="h-6 w-full rounded border border-brand-ink bg-white px-1.5 text-xs outline-none"
                                    placeholder="Topic or note..."
                                  />
                                  <button
                                    type="submit"
                                    disabled={savingNote || !addingNoteText.trim()}
                                    className="flex size-5 shrink-0 items-center justify-center rounded bg-brand-ink text-white hover:bg-brand-ink/90"
                                    title="Add topic"
                                    aria-label="Add topic"
                                  >
                                    <Check className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAddingNoteFor(null)}
                                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                                    title="Cancel"
                                    aria-label="Cancel"
                                  >
                                    <X className="size-3" />
                                  </button>
                                </form>
                              ) : (
                                cellNotes.length > 0 && (
                                  <div className="opacity-0 group-hover/topic:opacity-100 transition-opacity pt-0.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAddingNoteFor({ date: group.date, courseId: courseRow.id });
                                        setAddingNoteText("");
                                      }}
                                      className="text-[11px] text-muted-foreground hover:text-brand-ink flex items-center gap-1 font-medium"
                                    >
                                      <Plus className="size-2.5" />
                                      Add topic
                                    </button>
                                  </div>
                                )
                              )}

                              {cellNotes.length === 0 && !isAddingThis && (
                                <div
                                  className="flex items-center min-h-[1.5rem] cursor-pointer"
                                  onClick={() => {
                                    setAddingNoteFor({ date: group.date, courseId: courseRow.id });
                                    setAddingNoteText("");
                                  }}
                                >
                                  <span className="opacity-0 group-hover/topic:opacity-100 text-[11px] text-muted-foreground hover:text-brand-ink flex items-center gap-1 font-medium transition-opacity">
                                    <Plus className="size-3" />
                                    Add topic
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      )}
                    </td>

                    {/* Assignments Column */}
                    <td
                      className="py-1.5 px-3 align-top group/cell cursor-pointer"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("button") || target.closest("a") || target.closest("form") || target.closest("input")) return;
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

                                {/* Pin to Weekly Focus action */}
                                {onTogglePinAssignment && activeWeekStart && (
                                  (() => {
                                    const isPinnedInActiveWeek = weeklyFocusItems.some(
                                      (w) => w.assignment_id === assignment.id && w.week_start === activeWeekStart
                                    );
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onTogglePinAssignment(assignment.id);
                                        }}
                                        className={`p-0.5 transition-opacity rounded ml-auto shrink-0 ${
                                          isPinnedInActiveWeek
                                            ? "text-brand-ink opacity-100"
                                            : "text-muted-foreground opacity-0 group-hover/item:opacity-80 hover:text-brand-ink"
                                        }`}
                                        title={
                                          isPinnedInActiveWeek
                                            ? "Pinned in Weekly Focus (Click to remove pin)"
                                            : "Pin to Weekly Focus"
                                        }
                                        aria-label={
                                          isPinnedInActiveWeek
                                            ? "Pinned in Weekly Focus"
                                            : "Pin to Weekly Focus"
                                        }
                                      >
                                        <Pin
                                          className={`size-3 ${
                                            isPinnedInActiveWeek ? "fill-brand-ink" : ""
                                          }`}
                                        />
                                      </button>
                                    );
                                  })()
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
