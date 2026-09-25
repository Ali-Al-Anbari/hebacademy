"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocalToday } from "@/lib/local-calendar";
import {
  getMondayOfWeek,
  isTimeZone,
  localDate,
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
import { AssignmentDrawer } from "./assignment-drawer";
import { CoursePanel } from "./course-panel";
import {
  deleteWeeklyFocusItem,
  pinAssignmentToFocus,
} from "./focus-and-notes-actions";
import { PlannerCalendar } from "./planner-calendar";
import { SemesterControls } from "./semester-controls";
import { WeeklyFocus } from "./weekly-focus";

export function PlannerWorkspace({
  semesters,
  courses,
  meetings,
  exceptions,
  hebacademyCourses,
  assignments = [],
  customTypes = [],
  urls = [],
  subtasks = [],
  courseNotes = [],
  weeklyFocusItems = [],
}: {
  semesters: Semester[];
  courses: PlannerCourse[];
  meetings: CourseMeeting[];
  exceptions: MeetingException[];
  hebacademyCourses: { id: string; name: string }[];
  assignments?: PlannerAssignment[];
  customTypes?: PlannerCustomType[];
  urls?: AssignmentUrl[];
  subtasks?: AssignmentSubtask[];
  courseNotes?: PlannerCourseNote[];
  weeklyFocusItems?: PlannerWeeklyFocusItem[];
}) {
  const router = useRouter();
  const today = useLocalToday();
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scheduleCourseId, setScheduleCourseId] = useState<string | null>(null);

  // Assignment drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<PlannerAssignment | null>(null);
  const [drawerInitialDate, setDrawerInitialDate] = useState<string | null>(null);
  const [drawerInitialCourseId, setDrawerInitialCourseId] = useState<string | null>(null);
  const [createdCustomTypes, setCreatedCustomTypes] = useState<PlannerCustomType[]>([]);

  // Mobile Weekly Focus modal state
  const [mobileFocusOpen, setMobileFocusOpen] = useState(false);

  const allCustomTypes = useMemo(() => {
    const map = new Map(customTypes.map((t) => [t.id, t]));
    for (const t of createdCustomTypes) {
      map.set(t.id, t);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [customTypes, createdCustomTypes]);

  const visible = semesters.filter((semester) => Boolean(semester.archived_at) === archived);
  const selected =
    visible.find((semester) => semester.id === selectedId) ??
    (today ? visible.find((semester) => semester.start_date <= today && today <= semester.end_date) : null) ??
    visible[0] ??
    null;

  // Active week for Weekly Focus (defaults to Monday of current week or semester start)
  const [activeWeekStart, setActiveWeekStart] = useState<string>(() => {
    if (selected) {
      if (today && today >= selected.start_date && today <= selected.end_date) {
        return getMondayOfWeek(today);
      }
      return getMondayOfWeek(selected.start_date);
    }
    return getMondayOfWeek(today ?? localDate());
  });

  const selectedCourses = courses.filter((course) => course.semester_id === selected?.id);
  const selectedMeetings = meetings.filter((meeting) => meeting.semester_id === selected?.id);
  const selectedExceptions = exceptions.filter((exception) => exception.semester_id === selected?.id);
  const selectedAssignments = assignments.filter((assignment) => assignment.semester_id === selected?.id);
  const selectedUrls = urls.filter((u) => selectedAssignments.some((a) => a.id === u.assignment_id));
  const selectedSubtasks = subtasks.filter((s) => selectedAssignments.some((a) => a.id === s.assignment_id));
  const selectedCourseNotes = courseNotes.filter((n) => n.semester_id === selected?.id);
  const selectedWeeklyFocus = weeklyFocusItems.filter((w) => w.semester_id === selected?.id);

  const archivedCount = semesters.filter((semester) => semester.archived_at).length;

  const incompleteFocusCount = selectedWeeklyFocus.filter((item) => {
    if (item.week_start !== activeWeekStart) return false;
    if (item.assignment_id) {
      const a = selectedAssignments.find((asg) => asg.id === item.assignment_id);
      return a ? a.status !== "done" : false;
    }
    return !item.is_done;
  }).length;

  function saved(id?: string) {
    setSelectedId(id ?? null);
    setScheduleCourseId(null);
    router.refresh();
  }

  function handleOpenNewAssignment(initialDate?: string, initialCourseId?: string | null) {
    setEditingAssignment(null);
    setDrawerInitialDate(initialDate ?? null);
    setDrawerInitialCourseId(initialCourseId ?? null);
    setDrawerOpen(true);
  }

  function handleOpenEditAssignment(assignment: PlannerAssignment) {
    setEditingAssignment(assignment);
    setDrawerInitialDate(null);
    setDrawerInitialCourseId(null);
    setDrawerOpen(true);
  }

  function handleCustomTypeCreated(newType: PlannerCustomType) {
    setCreatedCustomTypes((prev) => {
      if (prev.some((t) => t.id === newType.id)) return prev;
      return [...prev, newType];
    });
  }

  async function handleTogglePinAssignment(assignmentId: string) {
    if (!selected) return;
    const isPinned = selectedWeeklyFocus.some(
      (w) => w.assignment_id === assignmentId && w.week_start === activeWeekStart
    );
    if (isPinned) {
      const pinItem = selectedWeeklyFocus.find(
        (w) => w.assignment_id === assignmentId && w.week_start === activeWeekStart
      );
      if (pinItem) {
        await deleteWeeklyFocusItem(pinItem.id);
        saved(selected.id);
      }
    } else {
      await pinAssignmentToFocus({
        semesterId: selected.id,
        weekStart: activeWeekStart,
        assignmentId,
      });
      saved(selected.id);
    }
  }

  async function handleToggleAssignmentStatus(assignment: PlannerAssignment) {
    await toggleAssignmentStatus(assignment.id, assignment.status);
    saved(selected?.id);
  }

  return (
    <>
      <header className="page-intro planner-intro">
        <p className="page-eyebrow">Academic workspace</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="page-title">Planner</h1>
            <p className="page-description">Keep your semester, classes, and assignments in view.</p>
          </div>
          {archivedCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setArchived(!archived);
                setSelectedId(null);
                setScheduleCourseId(null);
              }}
            >
              {archived ? "Active semesters" : `Archived (${archivedCount})`}
            </Button>
          )}
        </div>
      </header>

      {selected ? (
        <>
          <div className="planner-semester-bar">
            <div className="min-w-0">
              <label
                htmlFor="planner-semester-select"
                className="mb-1 block text-xs font-semibold text-muted-foreground"
              >
                {archived ? "Archived semester" : "Semester"}
              </label>
              <select
                id="planner-semester-select"
                className="planner-semester-select"
                value={selected.id}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setScheduleCourseId(null);
                }}
              >
                {visible.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.start_date} – {selected.end_date} · {selected.time_zone}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Mobile / Tablet Weekly Focus Trigger */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMobileFocusOpen(true)}
                className="xl:hidden h-8 text-xs font-semibold gap-1.5 border-[#dabac4] bg-[#fff9fb] hover:bg-[#ffeef3]"
              >
                <ListTodo className="size-3.5 text-brand-ink" />
                Weekly Focus
                {incompleteFocusCount > 0 && (
                  <span className="rounded-full bg-brand-ink text-white px-1.5 py-0.2 text-[10px] font-bold">
                    {incompleteFocusCount}
                  </span>
                )}
              </Button>

              <SemesterControls
                semester={selected}
                onSaved={(id) => {
                  if (selected.archived_at && !id) setArchived(false);
                  saved(id ?? (selected.archived_at ? selected.id : undefined));
                }}
              />
            </div>
          </div>

          {archived && (
            <p className="mt-4 text-sm text-muted-foreground">
              This archived semester remains readable. You can unarchive it to resume planning.
            </p>
          )}

          {/* 3-Column Responsive Planner Layout */}
          <div className="planner-workspace-layout mt-6 flex flex-col xl:flex-row gap-6 items-start">
            {/* Left: Classes & Meetings */}
            <div className="w-full xl:w-64 shrink-0">
              <CoursePanel
                key={`${selected.id}:${scheduleCourseId ?? "closed"}`}
                semester={selected}
                courses={selectedCourses}
                meetings={selectedMeetings}
                exceptions={selectedExceptions}
                hebacademyCourses={hebacademyCourses}
                scheduleCourseId={scheduleCourseId}
                setScheduleCourseId={setScheduleCourseId}
                onSaved={() => saved(selected.id)}
              />
            </div>

            {/* Center: Main Calendar / Spreadsheet */}
            <div className="min-w-0 flex-1 w-full">
              {!isTimeZone(selected.time_zone) ? (
                <p role="alert" className="notice-error">
                  This semester has an invalid time zone. Edit the semester before viewing its calendar.
                </p>
              ) : today ? (
                <PlannerCalendar
                  key={selected.id}
                  semester={selected}
                  courses={selectedCourses}
                  meetings={selectedMeetings}
                  exceptions={selectedExceptions}
                  assignments={selectedAssignments}
                  customTypes={allCustomTypes}
                  urls={selectedUrls}
                  subtasks={selectedSubtasks}
                  courseNotes={selectedCourseNotes}
                  weeklyFocusItems={selectedWeeklyFocus}
                  activeWeekStart={activeWeekStart}
                  today={today}
                  onEditRecurring={setScheduleCourseId}
                  onOpenAssignment={handleOpenEditAssignment}
                  onAddAssignment={handleOpenNewAssignment}
                  onTogglePinAssignment={handleTogglePinAssignment}
                  onSaved={() => saved(selected.id)}
                />
              ) : (
                <div role="status" className="py-8 text-sm text-muted-foreground">
                  Loading calendar…
                </div>
              )}
            </div>

            {/* Right: Desktop Sticky Weekly Focus */}
            <div className="hidden xl:block w-72 shrink-0 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
              <WeeklyFocus
                semester={selected}
                weekStart={activeWeekStart}
                onWeekChange={setActiveWeekStart}
                today={today ?? localDate()}
                courses={selectedCourses}
                assignments={selectedAssignments}
                focusItems={selectedWeeklyFocus}
                onOpenAssignment={handleOpenEditAssignment}
                onToggleAssignmentStatus={handleToggleAssignmentStatus}
                onSaved={() => saved(selected.id)}
              />
            </div>
          </div>

          {/* Mobile Weekly Focus Dialog */}
          <Dialog open={mobileFocusOpen} onOpenChange={setMobileFocusOpen}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md p-4">
              <DialogHeader className="sr-only">
                <DialogTitle>Weekly Focus</DialogTitle>
              </DialogHeader>
              <WeeklyFocus
                semester={selected}
                weekStart={activeWeekStart}
                onWeekChange={setActiveWeekStart}
                today={today ?? localDate()}
                courses={selectedCourses}
                assignments={selectedAssignments}
                focusItems={selectedWeeklyFocus}
                onOpenAssignment={(assignment) => {
                  setMobileFocusOpen(false);
                  handleOpenEditAssignment(assignment);
                }}
                onToggleAssignmentStatus={handleToggleAssignmentStatus}
                onSaved={() => saved(selected.id)}
              />
            </DialogContent>
          </Dialog>

          {/* Inline Assignment Drawer / Sheet */}
          <AssignmentDrawer
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            semester={selected}
            courses={selectedCourses}
            customTypes={allCustomTypes}
            assignment={editingAssignment}
            initialDate={drawerInitialDate}
            initialCourseId={drawerInitialCourseId}
            weeklyFocusItems={selectedWeeklyFocus}
            activeWeekStart={activeWeekStart}
            urls={selectedUrls}
            subtasks={selectedSubtasks}
            onSaved={() => saved(selected.id)}
            onDeleted={() => saved(selected.id)}
            onCustomTypeCreated={handleCustomTypeCreated}
            onTogglePin={handleTogglePinAssignment}
          />
        </>
      ) : (
        <div className="planner-empty mt-5">
          <h2 className="section-title">
            {archived ? "No archived semesters" : "Create your first semester"}
          </h2>
          <p className="page-description">
            {archived
              ? "Archived semesters will remain available here."
              : "Add your dates and time zone, then set up classes, weekly meetings, and assignments."}
          </p>
          <div className="mt-5">
            <SemesterControls
              semester={null}
              onSaved={(id) => {
                setArchived(false);
                saved(id);
              }}
            />
          </div>
          {archived && (
            <Button
              type="button"
              variant="ghost"
              className="mt-3"
              onClick={() => setArchived(false)}
            >
              Back to active semesters
            </Button>
          )}
        </div>
      )}
    </>
  );
}
