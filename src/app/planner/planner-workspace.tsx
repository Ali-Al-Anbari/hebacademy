"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { BookOpen, ListTodo, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocalToday } from "@/lib/local-calendar";
import {
  formatShortDate,
  getMondayOfWeek,
  isTimeZone,
  localDate,
  nextCalendarDay,
} from "@/lib/planner/dates";
import { parseVirtualAssignmentId, resolveEffectiveAssignments } from "@/lib/planner/recurrence";
import type {
  AssignmentException,
  AssignmentSubtask,
  AssignmentUrl,
  CourseMeeting,
  EffectiveAssignment,
  MeetingException,
  PlannerAssignment,
  PlannerAssignmentAttachment,
  PlannerAssignmentAttachmentRef,
  PlannerAssignmentDeck,
  PlannerAssignmentStudySchedule,
  PlannerCourse,
  PlannerCourseNote,
  PlannerCustomType,
  PlannerDeck,
  PlannerStudySchedule,
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
  assignmentExceptions = [],
  customTypes = [],
  urls = [],
  subtasks = [],
  courseNotes = [],
  weeklyFocusItems = [],
  attachments = [],
  attachmentRefs = [],
  hebacademyDecks = [],
  assignmentDecks = [],
  studySchedules = [],
  assignmentStudySchedules = [],
  scheduleProgress = {},
}: {
  semesters: Semester[];
  courses: PlannerCourse[];
  meetings: CourseMeeting[];
  exceptions: MeetingException[];
  hebacademyCourses: { id: string; name: string }[];
  assignments?: PlannerAssignment[];
  assignmentExceptions?: AssignmentException[];
  customTypes?: PlannerCustomType[];
  urls?: AssignmentUrl[];
  subtasks?: AssignmentSubtask[];
  courseNotes?: PlannerCourseNote[];
  weeklyFocusItems?: PlannerWeeklyFocusItem[];
  attachments?: PlannerAssignmentAttachment[];
  attachmentRefs?: PlannerAssignmentAttachmentRef[];
  hebacademyDecks?: PlannerDeck[];
  assignmentDecks?: PlannerAssignmentDeck[];
  studySchedules?: PlannerStudySchedule[];
  assignmentStudySchedules?: PlannerAssignmentStudySchedule[];
  scheduleProgress?: Record<string, { completed: number; total: number }>;
}) {
  const router = useRouter();
  const today = useLocalToday();
  const [archived, setArchived] = useState(false);

  const targetFromUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const assignId = params.get("assignment");
    if (!assignId) return null;
    const direct = assignments.find((a) => a.id === assignId);
    if (direct) return direct;
    const virtual = parseVirtualAssignmentId(assignId);
    if (!virtual) return null;
    const root = assignments.find((a) => a.id === virtual.rootId);
    if (!root) return null;
    const materialized = assignments.find((a) => a.parent_series_id === virtual.rootId
      && a.original_due_date === virtual.occurrenceDate);
    if (materialized) return materialized;
    const semester = semesters.find((item) => item.id === root.semester_id);
    if (!semester) return null;
    return resolveEffectiveAssignments({
      assignments: [root],
      exceptions: assignmentExceptions.filter((item) => item.parent_series_id === root.id),
      semester,
      rangeStart: virtual.occurrenceDate,
      rangeEnd: virtual.occurrenceDate,
      urls: urls.filter((item) => item.assignment_id === root.id),
      subtasks: subtasks.filter((item) => item.assignment_id === root.id),
    }).assignments.find((item) => item.isVirtual && item.originalOccurrenceDate === virtual.occurrenceDate) ?? null;
  }, [assignments, assignmentExceptions, semesters, subtasks, urls]);

  const [selectedId, setSelectedId] = useState<string | null>(
    () => targetFromUrl?.semester_id ?? null
  );
  const [scheduleCourseId, setScheduleCourseId] = useState<string | null>(null);

  // Classes Drawer state
  const [classesOpen, setClassesOpen] = useState(false);

  // Assignment Drawer state
  const [drawerOpen, setDrawerOpen] = useState(() => Boolean(targetFromUrl));
  const [editingAssignment, setEditingAssignment] = useState<(PlannerAssignment | EffectiveAssignment) | null>(
    () => targetFromUrl
  );
  const [drawerKey, setDrawerKey] = useState(0);
  const [drawerSavedId, setDrawerSavedId] = useState<string | null>(null);
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
  const selectedAssignmentExceptions = assignmentExceptions.filter((e) => e.semester_id === selected?.id);
  const selectedAssignments = assignments.filter((assignment) => assignment.semester_id === selected?.id);
  const selectedUrls = urls.filter((u) => selectedAssignments.some((a) => a.id === u.assignment_id));
  const selectedSubtasks = subtasks.filter((s) => selectedAssignments.some((a) => a.id === s.assignment_id));
  const selectedCourseNotes = courseNotes.filter((n) => n.semester_id === selected?.id);
  const selectedWeeklyFocus = weeklyFocusItems.filter((w) => w.semester_id === selected?.id);
  const selectedAttachments = attachments.filter((att) => att.semester_id === selected?.id);
  const selectedAttachmentRefs = attachmentRefs.filter((ref) => selectedAssignments.some((a) => a.id === ref.assignment_id));
  const currentDrawerAssignment = (() => {
    if (!editingAssignment) return null;
    const effective = editingAssignment as EffectiveAssignment;
    const occurrenceDate = effective.originalOccurrenceDate ?? editingAssignment.original_due_date;
    const wantedId = drawerSavedId ?? editingAssignment.id;
    const originalRootId = parseVirtualAssignmentId(editingAssignment.id)?.rootId ?? editingAssignment.parent_series_id;
    if (selected && occurrenceDate) {
      const resolved = resolveEffectiveAssignments({
        assignments: selectedAssignments,
        exceptions: selectedAssignmentExceptions,
        semester: selected,
        rangeStart: occurrenceDate,
        rangeEnd: nextCalendarDay(occurrenceDate),
        urls: selectedUrls,
        subtasks: selectedSubtasks,
      }).assignments;
      const occurrence = resolved.find((item) =>
        item.originalOccurrenceDate === occurrenceDate &&
        (item.id === wantedId || item.seriesRootId === wantedId || item.parent_series_id === wantedId ||
          (!drawerSavedId && originalRootId && (item.seriesRootId === originalRootId || item.parent_series_id === originalRootId)))
      );
      if (occurrence) return occurrence;
    }
    return selectedAssignments.find((item) => item.id === wantedId) ?? editingAssignment;
  })();

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
    setDrawerKey((value) => value + 1);
    setDrawerSavedId(null);
    setEditingAssignment(null);
    setDrawerInitialDate(initialDate ?? null);
    setDrawerInitialCourseId(initialCourseId ?? null);
    setDrawerOpen(true);
  }

  function handleOpenEditAssignment(assignment: PlannerAssignment | EffectiveAssignment) {
    setDrawerKey((value) => value + 1);
    setDrawerSavedId(null);
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

  function handleEditRecurring(courseId: string) {
    setScheduleCourseId(courseId);
    setClassesOpen(true);
  }

  async function handleTogglePinAssignment(assignmentId: string, occurrenceDate?: string | null) {
    if (!selected) return;
    const parsed = parseVirtualAssignmentId(assignmentId);
    const realId = parsed ? parsed.rootId : assignmentId;
    const occDate = occurrenceDate ?? (parsed ? parsed.occurrenceDate : null);
    const isPinned = selectedWeeklyFocus.some(
      (w) =>
        w.week_start === activeWeekStart &&
        (w.assignment_id === assignmentId ||
          (w.assignment_id === realId && (w.occurrence_date === occDate || !w.occurrence_date)))
    );
    if (isPinned) {
      const pinItem = selectedWeeklyFocus.find(
        (w) =>
          w.week_start === activeWeekStart &&
          (w.assignment_id === assignmentId ||
            (w.assignment_id === realId && (w.occurrence_date === occDate || !w.occurrence_date)))
      );
      if (pinItem) {
        await deleteWeeklyFocusItem(pinItem.id);
        saved(selected.id);
      }
    } else {
      await pinAssignmentToFocus({
        semesterId: selected.id,
        weekStart: activeWeekStart,
        assignmentId: realId,
        occurrenceDate: occDate,
      });
      saved(selected.id);
    }
  }

  async function handleToggleAssignmentStatus(assignment: PlannerAssignment | EffectiveAssignment) {
    const isVirt = "isVirtual" in assignment && Boolean(assignment.isVirtual);
    const parentId =
      "seriesRootId" in assignment && typeof assignment.seriesRootId === "string"
        ? assignment.seriesRootId
        : assignment.parent_series_id;
    const origDate =
      "originalOccurrenceDate" in assignment && typeof assignment.originalOccurrenceDate === "string"
        ? assignment.originalOccurrenceDate
        : assignment.original_due_date;
    await toggleAssignmentStatus(
      assignment.id,
      assignment.status,
      isVirt && parentId && origDate ? { parentSeriesId: parentId, originalDueDate: origDate } : undefined
    );
    saved(selected?.id);
  }

  return (
    <>
      {selected ? (
        <>
          {/* Compact Planner Header & Toolbar */}
          <div className="planner-semester-bar">
            {/* Left: Compact Semester Dropdown & Date Range & Settings */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              <div className="flex items-center gap-1.5">
                <select
                  id="planner-semester-select"
                  aria-label="Select semester"
                  value={selected.id}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setScheduleCourseId(null);
                  }}
                  className="font-heading font-bold text-lg sm:text-xl text-[#2A2024] bg-transparent outline-none cursor-pointer hover:text-brand-ink transition-colors pr-1 rounded"
                >
                  {visible.map((semester) => (
                    <option key={semester.id} value={semester.id}>
                      {semester.name}
                    </option>
                  ))}
                </select>
                {archived && (
                  <span className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    Archived
                  </span>
                )}
              </div>

              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                {formatShortDate(selected.start_date)} – {formatShortDate(selected.end_date)}
              </span>

              <SemesterControls
                semester={selected}
                onSaved={(id) => {
                  if (selected.archived_at && !id) setArchived(false);
                  saved(id ?? (selected.archived_at ? selected.id : undefined));
                }}
              />

              {archivedCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setArchived(!archived);
                    setSelectedId(null);
                    setScheduleCourseId(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-brand-ink font-medium underline underline-offset-2 transition-colors ml-1"
                >
                  {archived ? "Active semesters" : `Archived (${archivedCount})`}
                </button>
              )}
            </div>

            {/* Right: Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Classes Drawer Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setClassesOpen(true)}
                className="h-8 text-xs font-semibold gap-1.5 border-[#dabac4] bg-[#fff9fb] hover:bg-[#ffeef3]"
                title="Manage classes & schedules"
              >
                <BookOpen className="size-3.5 text-brand-ink" />
                Classes
                {selectedCourses.length > 0 && (
                  <span className="rounded-full bg-brand-ink/15 text-brand-ink px-1.5 py-0.2 text-[10px] font-bold">
                    {selectedCourses.length}
                  </span>
                )}
              </Button>

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

              {/* Add Assignment Primary Button */}
              <Button
                type="button"
                size="sm"
                onClick={() => handleOpenNewAssignment()}
                className="h-8 text-xs font-semibold gap-1 px-3"
              >
                <Plus className="size-3.5" />
                Assignment
              </Button>
            </div>
          </div>

          {archived && (
            <p className="mt-2 text-xs text-muted-foreground">
              This archived semester remains readable. You can unarchive it to resume planning.
            </p>
          )}

          {/* Optimized 2-Column Responsive Workspace: Dominant Planner + Compact Weekly Focus */}
          <div className="planner-workspace-layout mt-3.5 flex flex-col xl:flex-row gap-4 items-start">
            {/* Dominant Planner Surface: Calendar / Spreadsheet List */}
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
                  assignmentExceptions={selectedAssignmentExceptions}
                  customTypes={allCustomTypes}
                  urls={selectedUrls}
                  subtasks={selectedSubtasks}
                  courseNotes={selectedCourseNotes}
                  weeklyFocusItems={selectedWeeklyFocus}
                  activeWeekStart={activeWeekStart}
                  today={today}
                  onEditRecurring={handleEditRecurring}
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

            {/* Compact Desktop Weekly Focus (~280px) */}
            <div className="hidden xl:block w-[280px] shrink-0 sticky top-3 self-start max-h-[calc(100vh-2rem)] overflow-y-auto">
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

          {/* Classes Slide-out Drawer */}
          <DialogPrimitive.Root open={classesOpen} onOpenChange={setClassesOpen}>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Backdrop
                className="fixed inset-0 z-40 bg-[#261820]/30 backdrop-blur-[1px] duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
              />
              <DialogPrimitive.Popup
                className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-[#fff9fb] text-popover-foreground shadow-[-12px_0_40px_#23182025] outline-none overflow-y-auto p-5 sm:max-w-lg duration-200 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
              >
                <div className="flex items-center justify-between pb-3 border-b border-[#bd8f9e]">
                  <div>
                    <h2 className="text-lg font-bold font-heading text-[#2A2024]">Classes & Schedule</h2>
                    <p className="text-xs text-muted-foreground">{selected.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setClassesOpen(false)}
                    className="flex size-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-ink transition-colors"
                    title="Close classes drawer"
                    aria-label="Close classes drawer"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="pt-3">
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
              </DialogPrimitive.Popup>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>

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
            key={drawerKey}
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            semester={selected}
            courses={selectedCourses}
            customTypes={allCustomTypes}
            assignments={selectedAssignments}
            assignment={currentDrawerAssignment}
            initialDate={drawerInitialDate}
            initialCourseId={drawerInitialCourseId}
            weeklyFocusItems={selectedWeeklyFocus}
            activeWeekStart={activeWeekStart}
            urls={selectedUrls}
            subtasks={selectedSubtasks}
            attachments={selectedAttachments}
            attachmentRefs={selectedAttachmentRefs}
            hebacademyCourses={hebacademyCourses}
            hebacademyDecks={hebacademyDecks}
            assignmentDecks={assignmentDecks}
            studySchedules={studySchedules}
            assignmentStudySchedules={assignmentStudySchedules}
            scheduleProgress={scheduleProgress}
            onSaved={(id, scope) => {
              if (id && scope !== "series") setDrawerSavedId(id);
              saved(selected.id);
            }}
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
