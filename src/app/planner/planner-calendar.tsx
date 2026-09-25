"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import FullCalendar, { type CalendarRef, type EventClickInfo, type EventInput } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  displayTime,
  formatShortDate,
  meetingOccurrences,
  nextCalendarDay,
  type MeetingOccurrence,
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
import { removeMeetingException, saveMeetingException } from "./actions";
import { AssignmentListView } from "./assignment-list";

const plugins = [classicTheme, dayGridPlugin, timeGridPlugin, interactionPlugin];

export function PlannerCalendar({
  semester,
  courses,
  meetings,
  exceptions,
  assignments,
  customTypes,
  urls,
  subtasks,
  today,
  onEditRecurring,
  onOpenAssignment,
  onAddAssignment,
  onSaved,
}: {
  semester: Semester;
  courses: PlannerCourse[];
  meetings: CourseMeeting[];
  exceptions: MeetingException[];
  assignments: PlannerAssignment[];
  customTypes: PlannerCustomType[];
  urls: AssignmentUrl[];
  subtasks: AssignmentSubtask[];
  today: string | null;
  onEditRecurring: (courseId: string) => void;
  onOpenAssignment: (assignment: PlannerAssignment) => void;
  onAddAssignment: (initialDate?: string) => void;
  onSaved: () => void;
}) {
  const calendar = useRef<CalendarRef>(null);
  const inFlight = useRef(false);
  const lastClickRef = useRef<{ date: string; time: number } | null>(null);

  const [view, setView] = useState<"dayGridMonth" | "timeGridWeek" | "list">("dayGridMonth");
  const [title, setTitle] = useState("");
  const [tappedDate, setTappedDate] = useState<string | null>(null);

  // Meeting occurrence edit dialog state
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingOccurrence | null>(null);
  const [changingMeeting, setChangingMeeting] = useState(false);
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingStart, setMeetingStart] = useState("");
  const [meetingEnd, setMeetingEnd] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const meetingById = useMemo(() => new Map(meetings.map((meeting) => [meeting.id, meeting])), [meetings]);
  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

  function handleEventClick(info: EventClickInfo) {
    const type = info.event.extendedProps.type;
    if (type === "assignment") {
      const assignment = info.event.extendedProps.assignment as PlannerAssignment;
      onOpenAssignment(assignment);
      return;
    }

    if (type === "meeting") {
      const occurrence = info.event.extendedProps.occurrence as MeetingOccurrence;
      setSelectedMeeting(occurrence);
      setMeetingDate(occurrence.date);
      setMeetingStart(occurrence.startTime.slice(0, 5));
      setMeetingEnd(occurrence.endTime.slice(0, 5));
      setMeetingLocation(occurrence.location ?? "");
      setChangingMeeting(false);
      setMessage("");
    }
  }

  function handleDateClick(info: { dateStr: string }) {
    const clicked = info.dateStr.slice(0, 10);
    const now = Date.now();

    if (
      lastClickRef.current &&
      lastClickRef.current.date === clicked &&
      now - lastClickRef.current.time < 350
    ) {
      // Desktop double click
      lastClickRef.current = null;
      setTappedDate(null);
      onAddAssignment(clicked);
    } else {
      lastClickRef.current = { date: clicked, time: now };
      setTappedDate(clicked);
    }
  }

  async function changeMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMeeting || inFlight.current) return;
    const original = meetingById.get(selectedMeeting.meetingId);
    if (!original) {
      setMessage("This meeting is no longer available.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const timeChanged =
        meetingStart !== original.starts_at.slice(0, 5) || meetingEnd !== original.ends_at.slice(0, 5);
      const result = await saveMeetingException(selectedMeeting.meetingId, selectedMeeting.originalDate, "changed", {
        replacement_date: meetingDate === selectedMeeting.originalDate ? null : meetingDate,
        replacement_starts_at: timeChanged ? meetingStart : null,
        replacement_ends_at: timeChanged ? meetingEnd : null,
        replacement_location: meetingLocation === (original.location ?? "") ? null : meetingLocation,
      });
      if (result.error) setMessage(result.error);
      else {
        setSelectedMeeting(null);
        onSaved();
      }
    } catch {
      setMessage("Could not change this meeting. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function cancelOrRestoreMeeting(restore: boolean) {
    if (!selectedMeeting || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = restore
        ? await removeMeetingException(selectedMeeting.meetingId, selectedMeeting.originalDate)
        : await saveMeetingException(selectedMeeting.meetingId, selectedMeeting.originalDate, "cancelled", null);
      if (result.error) setMessage(result.error);
      else {
        setSelectedMeeting(null);
        onSaved();
      }
    } catch {
      setMessage("Could not update this meeting. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function changeView(next: "dayGridMonth" | "timeGridWeek" | "list") {
    setView(next);
    if (next !== "list") {
      calendar.current?.getApi().changeView(next);
      setTappedDate(null);
    }
  }

  return (
    <section className="planner-calendar-wrap" aria-label={`${semester.name} class and assignment planner`}>
      {/* Top Toolbar */}
      <div className="planner-calendar-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          {view !== "list" ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => calendar.current?.getApi().today()}>
                Today
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Previous period"
                onClick={() => calendar.current?.getApi().prev()}
              >
                ‹
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Next period"
                onClick={() => calendar.current?.getApi().next()}
              >
                ›
              </Button>
              <h2 className="ml-1 font-heading text-lg font-semibold sm:text-xl" aria-live="polite">
                {title}
              </h2>
            </>
          ) : (
            <h2 className="font-heading text-lg font-semibold sm:text-xl">Assignments List</h2>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Planner view">
            <Button
              type="button"
              size="sm"
              variant={view === "dayGridMonth" ? "default" : "ghost"}
              aria-pressed={view === "dayGridMonth"}
              onClick={() => changeView("dayGridMonth")}
            >
              Month
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "timeGridWeek" ? "default" : "ghost"}
              aria-pressed={view === "timeGridWeek"}
              onClick={() => changeView("timeGridWeek")}
            >
              Week
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "list" ? "default" : "ghost"}
              aria-pressed={view === "list"}
              onClick={() => changeView("list")}
            >
              List
            </Button>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => onAddAssignment()}
            className="gap-1 font-semibold"
          >
            <Plus className="size-4" />
            Add assignment
          </Button>
        </div>
      </div>

      {/* Tapped Date Selection Banner (Mobile/Quick add) */}
      {tappedDate && view !== "list" && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50/80 px-3.5 py-2 text-xs">
          <span>
            Selected day: <strong>{formatShortDate(tappedDate)}</strong> ({tappedDate})
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs font-semibold gap-1"
              onClick={() => {
                onAddAssignment(tappedDate);
                setTappedDate(null);
              }}
            >
              <Plus className="size-3" />
              Add assignment
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setTappedDate(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Calendar surface (kept mounted to preserve state) */}
      <div className={view === "list" ? "hidden" : "block"}>
        <div className="planner-calendar">
          <FullCalendar
            ref={calendar}
            plugins={plugins}
            initialView="dayGridMonth"
            initialDate={
              today && today >= semester.start_date && today <= semester.end_date
                ? today
                : semester.start_date
            }
            timeZone={semester.time_zone}
            headerToolbar={false}
            firstDay={1}
            height="auto"
            dayMaxEvents={4}
            nowIndicator
            weekends
            allDaySlot={true}
            allDayText="Due"
            slotMinTime="06:00:00"
            slotMaxTime="22:00:00"
            datesSet={(info) => setTitle(info.view.title)}
            events={(info, success) => {
              const startDate = info.startStr.slice(0, 10);
              const endDate = info.endStr.slice(0, 10);

              // 1. Class meetings
              const meetingItems: EventInput[] = meetingOccurrences(
                semester,
                courses,
                meetings,
                exceptions,
                startDate,
                endDate
              ).map((item) => ({
                id: `meeting:${item.id}`,
                title: item.courseName,
                start: `${item.date}T${item.startTime}`,
                end: `${item.date}T${item.endTime}`,
                backgroundColor: "#fff8fa",
                borderColor: item.color,
                textColor: "#2A2024",
                extendedProps: { type: "meeting", occurrence: item },
              }));

              // 2. Assignments
              const assignmentItems: EventInput[] = assignments
                .filter((assignment) => {
                  const effStart = assignment.start_date ?? assignment.due_date;
                  const effEnd = assignment.due_date;
                  return effEnd >= startDate && effStart <= endDate;
                })
                .map((assignment) => {
                  const course = assignment.planner_course_id
                    ? courseById.get(assignment.planner_course_id)
                    : null;
                  const color = course ? course.color : "#922c50";
                  const isMultiDay = Boolean(
                    assignment.start_date && assignment.start_date !== assignment.due_date
                  );
                  const isDone = assignment.status === "done";

                  // FullCalendar all-day end is exclusive, database due_date is inclusive
                  const start = isMultiDay ? assignment.start_date! : assignment.due_date;
                  const end = isMultiDay ? nextCalendarDay(assignment.due_date) : undefined;

                  return {
                    id: `assignment:${assignment.id}`,
                    title: assignment.title,
                    start,
                    end,
                    allDay: true,
                    backgroundColor: isDone ? "#f5edf0" : "#ffffff",
                    borderColor: color,
                    textColor: isDone ? "#70545e" : "#2A2024",
                    extendedProps: {
                      type: "assignment",
                      assignment,
                      color,
                      courseName: course?.name ?? null,
                    },
                  };
                });

              success([...meetingItems, ...assignmentItems]);
            }}
            eventClick={handleEventClick}
            dateClick={handleDateClick}
            eventContent={(info) => {
              const type = info.event.extendedProps.type;
              if (type === "assignment") {
                const assignment = info.event.extendedProps.assignment as PlannerAssignment;
                const isDone = assignment.status === "done";
                const isImportant = assignment.priority === "important";
                const color = info.event.extendedProps.color as string;
                const isMultiDay = Boolean(
                  assignment.start_date && assignment.start_date !== assignment.due_date
                );

                return (
                  <span className={`planner-assignment-pill ${isDone ? "planner-assignment-pill--done" : ""}`}>
                    <span
                      className="planner-assignment-dot"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    {isImportant && (
                      <span className="planner-assignment-bang" title="Important" aria-label="Important">
                        !
                      </span>
                    )}
                    <span className="planner-assignment-title">
                      {info.event.title}
                    </span>
                    {assignment.due_time && !isMultiDay && (
                      <span className="planner-assignment-time">
                        {displayTime(assignment.due_time)}
                      </span>
                    )}
                  </span>
                );
              }

              // Class meeting
              const occurrence = info.event.extendedProps.occurrence as MeetingOccurrence;
              return (
                <span className="planner-event-content">
                  <strong>
                    <i
                      className="planner-event-marker"
                      style={{ backgroundColor: occurrence.color }}
                      aria-hidden="true"
                    />
                    {info.event.title}
                  </strong>
                  <span>
                    {info.timeText}
                    {occurrence?.location ? ` · ${occurrence.location}` : ""}
                  </span>
                </span>
              );
            }}
            dayCellTopContent={(info) => {
              const day =
                calendar.current?.getApi().formatIso(info.date, true) ??
                info.date.toISOString().slice(0, 10);
              if (view !== "dayGridMonth" || day < semester.start_date || day > semester.end_date) {
                return info.dayNumberText;
              }
              return (
                <span className="planner-day-heading">
                  <span>{info.dayNumberText}</span>
                  <span
                    className="planner-presence"
                    title={`Classes: ${courses.map((c) => c.name).join(", ")}`}
                    aria-label={`${courses.length} classes available`}
                  >
                    {courses.slice(0, 4).map((c) => (
                      <span
                        key={c.id}
                        className="planner-presence-dot"
                        style={{ backgroundColor: c.color, opacity: 0.28 }}
                      />
                    ))}
                    {courses.length > 4 && (
                      <span className="planner-presence-more">+{courses.length - 4}</span>
                    )}
                  </span>
                </span>
              );
            }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Double-click an empty day to add an assignment. Click any assignment or class meeting to view details.
        </p>
      </div>

      {/* List view */}
      {view === "list" && (
        <AssignmentListView
          semester={semester}
          courses={courses}
          customTypes={customTypes}
          assignments={assignments}
          urls={urls}
          subtasks={subtasks}
          today={today ?? semester.start_date}
          onOpenAssignment={onOpenAssignment}
          onAddAssignment={() => onAddAssignment()}
          onStatusChanged={onSaved}
        />
      )}

      {/* Class Meeting Occurrence Dialog */}
      <Dialog
        open={Boolean(selectedMeeting)}
        onOpenChange={(open) => {
          if (!open && !busy) setSelectedMeeting(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              {selectedMeeting?.courseName}
            </DialogTitle>
            <DialogDescription>
              {selectedMeeting?.changed ? "Changed class meeting" : "Regular class meeting"} ·{" "}
              {selectedMeeting?.date} ·{" "}
              {selectedMeeting &&
                `${displayTime(selectedMeeting.startTime)}–${displayTime(selectedMeeting.endTime)}`}
            </DialogDescription>
          </DialogHeader>
          {selectedMeeting?.location && (
            <p className="text-sm">Location: {selectedMeeting.location}</p>
          )}
          {message && <p role="alert" className="notice-error text-sm">{message}</p>}
          {changingMeeting ? (
            <form onSubmit={changeMeeting} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="planner-change-date">Date</Label>
                <Input
                  id="planner-change-date"
                  type="date"
                  required
                  min={semester.start_date}
                  max={semester.end_date}
                  value={meetingDate}
                  disabled={busy}
                  onChange={(event) => setMeetingDate(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="planner-change-start">Start</Label>
                  <Input
                    id="planner-change-start"
                    type="time"
                    required
                    value={meetingStart}
                    disabled={busy}
                    onChange={(event) => setMeetingStart(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="planner-change-end">End</Label>
                  <Input
                    id="planner-change-end"
                    type="time"
                    required
                    value={meetingEnd}
                    disabled={busy}
                    onChange={(event) => setMeetingEnd(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="planner-change-location">Location</Label>
                <Input
                  id="planner-change-location"
                  maxLength={200}
                  value={meetingLocation}
                  disabled={busy}
                  onChange={(event) => setMeetingLocation(event.target.value)}
                />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setChangingMeeting(false)}>
                  Back
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save this occurrence"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (selectedMeeting) {
                    onEditRecurring(selectedMeeting.courseId);
                    setSelectedMeeting(null);
                  }
                }}
              >
                Edit weekly meetings
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setChangingMeeting(true)}>
                Change this occurrence
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void cancelOrRestoreMeeting(false)}
              >
                {busy ? "Saving…" : "Cancel this class"}
              </Button>
              {selectedMeeting?.changed && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void cancelOrRestoreMeeting(true)}
                >
                  Restore regular meeting
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
