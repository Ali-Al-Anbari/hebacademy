"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import FullCalendar, { type CalendarRef, type EventClickInfo, type EventInput } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayTime, meetingOccurrences, type MeetingOccurrence } from "@/lib/planner/dates";
import type { CourseMeeting, MeetingException, PlannerCourse, Semester } from "@/lib/planner/types";
import { removeMeetingException, saveMeetingException } from "./actions";

const plugins = [classicTheme, dayGridPlugin, timeGridPlugin];

export function PlannerCalendar({ semester, courses, meetings, exceptions, today, onEditRecurring, onSaved }: {
  semester: Semester;
  courses: PlannerCourse[];
  meetings: CourseMeeting[];
  exceptions: MeetingException[];
  today: string | null;
  onEditRecurring: (courseId: string) => void;
  onSaved: () => void;
}) {
  const calendar = useRef<CalendarRef>(null);
  const inFlight = useRef(false);
  const [view, setView] = useState<"dayGridMonth" | "timeGridWeek">("dayGridMonth");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<MeetingOccurrence | null>(null);
  const [changing, setChanging] = useState(false);
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const meetingById = useMemo(() => new Map(meetings.map((meeting) => [meeting.id, meeting])), [meetings]);

  function openEvent(info: EventClickInfo) {
    const occurrence = info.event.extendedProps.occurrence as MeetingOccurrence;
    setSelected(occurrence);
    setDate(occurrence.date);
    setStart(occurrence.startTime.slice(0, 5));
    setEnd(occurrence.endTime.slice(0, 5));
    setLocation(occurrence.location ?? "");
    setChanging(false);
    setMessage("");
  }

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || inFlight.current) return;
    const original = meetingById.get(selected.meetingId);
    if (!original) { setMessage("This meeting is no longer available."); return; }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const timeChanged = start !== original.starts_at.slice(0, 5) || end !== original.ends_at.slice(0, 5);
      const result = await saveMeetingException(selected.meetingId, selected.originalDate, "changed", {
        replacement_date: date === selected.originalDate ? null : date,
        replacement_starts_at: timeChanged ? start : null,
        replacement_ends_at: timeChanged ? end : null,
        replacement_location: location === (original.location ?? "") ? null : location,
      });
      if (result.error) setMessage(result.error);
      else { setSelected(null); onSaved(); }
    } catch { setMessage("Could not change this meeting. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function cancelOrRestore(restore: boolean) {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = restore
        ? await removeMeetingException(selected.meetingId, selected.originalDate)
        : await saveMeetingException(selected.meetingId, selected.originalDate, "cancelled", null);
      if (result.error) setMessage(result.error);
      else { setSelected(null); onSaved(); }
    } catch { setMessage("Could not update this meeting. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function changeView(next: "dayGridMonth" | "timeGridWeek") {
    calendar.current?.getApi().changeView(next);
    setView(next);
  }

  return <section className="planner-calendar-wrap" aria-label={`${semester.name} class calendar`}>
    <div className="planner-calendar-toolbar">
      <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" size="sm" onClick={() => calendar.current?.getApi().today()}>Today</Button><Button type="button" variant="ghost" size="sm" aria-label="Previous period" onClick={() => calendar.current?.getApi().prev()}>‹</Button><Button type="button" variant="ghost" size="sm" aria-label="Next period" onClick={() => calendar.current?.getApi().next()}>›</Button><h2 className="ml-1 font-heading text-lg font-semibold sm:text-xl" aria-live="polite">{title}</h2></div>
      <div className="flex gap-1" role="group" aria-label="Calendar view"><Button type="button" size="sm" variant={view === "dayGridMonth" ? "default" : "ghost"} aria-pressed={view === "dayGridMonth"} onClick={() => changeView("dayGridMonth")}>Month</Button><Button type="button" size="sm" variant={view === "timeGridWeek" ? "default" : "ghost"} aria-pressed={view === "timeGridWeek"} onClick={() => changeView("timeGridWeek")}>Week</Button></div>
    </div>
    <div className="planner-calendar">
      <FullCalendar ref={calendar} plugins={plugins} initialView="dayGridMonth" initialDate={today && today >= semester.start_date && today <= semester.end_date ? today : semester.start_date}
        timeZone={semester.time_zone} headerToolbar={false} firstDay={1} height="auto" dayMaxEvents={3}
        nowIndicator weekends allDaySlot={false} slotMinTime="06:00:00" slotMaxTime="22:00:00"
        datesSet={(info) => setTitle(info.view.title)}
        events={(info, success) => {
          const startDate = info.startStr.slice(0, 10);
          const endDate = info.endStr.slice(0, 10);
          const items: EventInput[] = meetingOccurrences(semester, courses, meetings, exceptions, startDate, endDate)
            .map((item) => ({ id: item.id, title: item.courseName,
              start: `${item.date}T${item.startTime}`, end: `${item.date}T${item.endTime}`,
              backgroundColor: "#fff8fa", borderColor: item.color,
              textColor: "#241C20", extendedProps: { occurrence: item } }));
          success(items);
        }}
        eventClick={openEvent}
        eventContent={(info) => <span className="planner-event-content"><strong><i className="planner-event-marker" style={{ backgroundColor: (info.event.extendedProps.occurrence as MeetingOccurrence).color }} aria-hidden="true" />{info.event.title}</strong><span>{info.timeText}{info.event.extendedProps.occurrence?.location ? ` · ${info.event.extendedProps.occurrence.location}` : ""}</span></span>}
        dayCellTopContent={(info) => {
          const day = calendar.current?.getApi().formatIso(info.date, true)
            ?? info.date.toISOString().slice(0, 10);
          if (view !== "dayGridMonth" || day < semester.start_date || day > semester.end_date) return info.dayNumberText;
          return <span className="planner-day-heading"><span>{info.dayNumberText}</span><span className="planner-presence" title={`Courses available: ${courses.map((course) => course.name).join(", ")}`} aria-label={`${courses.length} semester courses available`}>
            {courses.slice(0, 4).map((course) => <span key={course.id} className="planner-presence-dot" style={{ backgroundColor: course.color, opacity: .42 }} />)}{courses.length > 4 && <span className="planner-presence-more">+{courses.length - 4}</span>}
          </span></span>;
        }}
      />
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Select a class meeting to change just that day, or edit its weekly pattern.</p>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !busy) setSelected(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle className="text-xl font-semibold">{selected?.courseName}</DialogTitle><DialogDescription>{selected?.changed ? "Changed class meeting" : "Regular class meeting"} · {selected?.date} · {selected && `${displayTime(selected.startTime)}–${displayTime(selected.endTime)}`}</DialogDescription></DialogHeader>
      {selected?.location && <p className="text-sm">Location: {selected.location}</p>}
      {message && <p role="alert" className="notice-error text-sm">{message}</p>}
      {changing ? <form onSubmit={change} className="space-y-4"><div className="space-y-2"><Label htmlFor="planner-change-date">Date</Label><Input id="planner-change-date" type="date" required min={semester.start_date} max={semester.end_date} value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="planner-change-start">Start</Label><Input id="planner-change-start" type="time" required value={start} disabled={busy} onChange={(event) => setStart(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="planner-change-end">End</Label><Input id="planner-change-end" type="time" required value={end} disabled={busy} onChange={(event) => setEnd(event.target.value)} /></div></div>
        <div className="space-y-2"><Label htmlFor="planner-change-location">Location</Label><Input id="planner-change-location" maxLength={200} value={location} disabled={busy} onChange={(event) => setLocation(event.target.value)} /></div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => setChanging(false)}>Back</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save this occurrence"}</Button></div>
      </form> : <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => { if (selected) { onEditRecurring(selected.courseId); setSelected(null); } }}>Edit weekly meetings</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setChanging(true)}>Change this occurrence</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => void cancelOrRestore(false)}>{busy ? "Saving…" : "Cancel this class"}</Button>{selected?.changed && <Button type="button" variant="ghost" disabled={busy} onClick={() => void cancelOrRestore(true)}>Restore regular meeting</Button>}</div>}
    </DialogContent></Dialog>
  </section>;
}
