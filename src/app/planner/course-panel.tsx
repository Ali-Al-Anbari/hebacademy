"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { displayTime } from "@/lib/planner/dates";
import type { CourseDraft, CourseMeeting, MeetingException, MeetingSlot, PlannerCourse, Semester } from "@/lib/planner/types";
import { deletePlannerCourse, removeMeetingException, saveCourseMeetings, savePlannerCourse } from "./actions";

const colors = [
  { name: "Rose", value: "#B33F68" }, { name: "Teal", value: "#337B70" },
  { name: "Violet", value: "#6C56A2" }, { name: "Clay", value: "#A35437" },
  { name: "Blue", value: "#396A9D" }, { name: "Plum", value: "#7D566E" },
];
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const selectClass = "h-11 w-full rounded-lg border border-input bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
type MeetingGroup = { days: number[]; start: string; end: string; location: string };
const newGroup = (): MeetingGroup => ({ days: [], start: "09:00", end: "10:00", location: "" });

function groupsFromMeetings(meetings: CourseMeeting[]): MeetingGroup[] {
  const grouped = new Map<string, MeetingGroup>();
  for (const meeting of meetings) {
    const key = `${meeting.starts_at.slice(0, 5)}:${meeting.ends_at.slice(0, 5)}:${meeting.location ?? ""}`;
    const group = grouped.get(key) ?? { days: [], start: meeting.starts_at.slice(0, 5),
      end: meeting.ends_at.slice(0, 5), location: meeting.location ?? "" };
    group.days.push(meeting.weekday);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

export function CoursePanel({ semester, courses, meetings, exceptions, hebacademyCourses,
  scheduleCourseId, setScheduleCourseId, onSaved }: {
  semester: Semester;
  courses: PlannerCourse[];
  meetings: CourseMeeting[];
  exceptions: MeetingException[];
  hebacademyCourses: { id: string; name: string }[];
  scheduleCourseId: string | null;
  setScheduleCourseId: (id: string | null) => void;
  onSaved: () => void;
}) {
  const inFlight = useRef(false);
  const [editingCourse, setEditingCourse] = useState<PlannerCourse | "new" | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<PlannerCourse | null>(null);
  const [draft, setDraft] = useState<CourseDraft>({ name: "", color: colors[0].value, hebacademy_course_id: null });
  const [groups, setGroups] = useState<MeetingGroup[]>(() => groupsFromMeetings(
    meetings.filter((meeting) => meeting.planner_course_id === scheduleCourseId)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const scheduleCourse = courses.find((course) => course.id === scheduleCourseId);

  function openCourse(course: PlannerCourse | "new") {
    setDraft(course === "new" ? { name: "", color: colors[0].value, hebacademy_course_id: null }
      : { name: course.name, color: course.color, hebacademy_course_id: course.hebacademy_course_id });
    setMessage("");
    setEditingCourse(course);
  }

  function openMeetings(courseId: string) {
    const source = meetings.filter((meeting) => meeting.planner_course_id === courseId);
    setGroups(groupsFromMeetings(source));
    setMessage("");
    setScheduleCourseId(courseId);
  }

  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCourse || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await savePlannerCourse(editingCourse === "new" ? null : editingCourse.id,
        semester.id, draft);
      if (result.error) setMessage(result.error);
      else { setEditingCourse(null); onSaved(); }
    } catch { setMessage("Could not save this class. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function saveMeetings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scheduleCourseId || inFlight.current) return;
    if (groups.some((group) => !group.days.length || !group.start || !group.end || group.end <= group.start)) {
      setMessage("Choose at least one day and valid start/end times for each schedule row.");
      return;
    }
    const slots: MeetingSlot[] = groups.flatMap((group) => group.days.map((day) => ({
      weekday: day, starts_at: group.start, ends_at: group.end,
      location: group.location.trim() || null,
    })));
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await saveCourseMeetings(scheduleCourseId, slots);
      if (result.error) setMessage(result.error);
      else { setScheduleCourseId(null); onSaved(); }
    } catch { setMessage("Could not save the meeting schedule. Refresh before retrying."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function removeCourse() {
    if (!deletingCourse || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await deletePlannerCourse(deletingCourse.id);
      if (result.error) setMessage(result.error);
      else { setDeletingCourse(null); onSaved(); }
    } catch { setMessage("Could not delete this class."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function restore(meetingId: string, date: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await removeMeetingException(meetingId, date);
      if (result.error) setMessage(result.error);
      else onSaved();
    } catch { setMessage("Could not restore this class meeting."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function updateGroup(index: number, patch: Partial<MeetingGroup>) {
    setGroups((items) => items.map((item, at) => at === index ? { ...item, ...patch } : item));
  }

  return <section aria-labelledby="planner-classes-title" className="planner-classes">
    <div className="flex items-center justify-between gap-3 border-b border-[#bd8f9e] pb-3">
      <div><h2 id="planner-classes-title" className="section-title">Classes</h2><p className="section-meta">{courses.length} {courses.length === 1 ? "class" : "classes"} this semester</p></div>
      <Button type="button" variant="secondary" onClick={() => openCourse("new")}>Add class</Button>
    </div>
    {message && !editingCourse && !scheduleCourseId && !deletingCourse && <p role="alert" className="notice-error mt-3 text-sm">{message}</p>}
    {courses.length ? <ul className="divide-y divide-[#bd8f9e]">
      {courses.map((course) => {
        const slots = meetings.filter((meeting) => meeting.planner_course_id === course.id);
        const overrides = exceptions.filter((exception) => slots.some((slot) => slot.id === exception.meeting_id));
        return <li key={course.id} className="py-4">
          <div className="flex items-start gap-3"><span className="mt-1.5 size-3 shrink-0 rounded-full border border-foreground/25" style={{ backgroundColor: course.color }} aria-hidden="true" />
            <div className="min-w-0 flex-1"><h3 className="break-words font-heading font-semibold">{course.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{slots.length ? slots.map((slot) => `${weekdays[slot.weekday - 1]} ${displayTime(slot.starts_at)}`).join(" · ") : "No meeting times yet"}</p>
              {course.hebacademy_course_id && <p className="mt-1 text-xs text-muted-foreground">Linked to {hebacademyCourses.find((item) => item.id === course.hebacademy_course_id)?.name ?? "a Hebacademy course"}</p>}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm"><button type="button" className="planner-text-action" onClick={() => openMeetings(course.id)}>Meetings</button><button type="button" className="planner-text-action" onClick={() => openCourse(course)}>Edit</button><button type="button" className="planner-text-action text-destructive" onClick={() => { setMessage(""); setDeletingCourse(course); }}>Delete</button></div>
              {overrides.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">{overrides.length} individual {overrides.length === 1 ? "change" : "changes"}</summary><ul className="mt-2 space-y-2">{overrides.map((override) => <li key={override.id} className="flex flex-wrap items-center justify-between gap-2"><span>{override.original_date}: {override.kind === "cancelled" ? "Canceled" : `Moved/changed${override.replacement_date ? ` to ${override.replacement_date}` : ""}`}</span><button type="button" disabled={busy} className="planner-text-action" onClick={() => void restore(override.meeting_id, override.original_date)}>Restore</button></li>)}</ul></details>}
            </div>
          </div>
        </li>;
      })}</ul> : <p className="py-5 text-sm text-muted-foreground">Add a class to place its weekly meetings on the calendar.</p>}

    <Dialog open={Boolean(editingCourse)} onOpenChange={(open) => { if (!open && !busy) setEditingCourse(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle className="text-xl font-semibold">{editingCourse === "new" ? "Add class" : "Edit class"}</DialogTitle><DialogDescription>Planner classes can stand alone or link to a Hebacademy course.</DialogDescription></DialogHeader>
        <form onSubmit={saveCourse} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="planner-course-name">Class name</Label><Input id="planner-course-name" required maxLength={120} value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ocular Anatomy" /></div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Class color</legend><div className="flex flex-wrap gap-2">{colors.map((color) => <label key={color.value} className="cursor-pointer"><input type="radio" name="course-color" className="sr-only peer" checked={draft.color.toUpperCase() === color.value} onChange={() => setDraft({ ...draft, color: color.value })} disabled={busy} /><span className="block size-9 rounded-full border-2 border-white shadow-[0_0_0_1px_#a5828e] peer-checked:shadow-[0_0_0_3px_#2A2024] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring" style={{ backgroundColor: color.value }} /><span className="sr-only">{color.name}</span></label>)}</div></fieldset>
          <div className="flex items-center gap-3"><Label htmlFor="planner-custom-color">Custom color</Label><input id="planner-custom-color" type="color" className="size-10 cursor-pointer rounded border border-input bg-white p-1" value={draft.color} disabled={busy} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /><span className="text-sm text-muted-foreground">{draft.color.toUpperCase()}</span></div>
          <div className="space-y-2"><Label htmlFor="planner-course-link">Hebacademy course (optional)</Label><select id="planner-course-link" className={selectClass} value={draft.hebacademy_course_id ?? ""} disabled={busy} onChange={(event) => setDraft({ ...draft, hebacademy_course_id: event.target.value || null })}><option value="">No link</option>{hebacademyCourses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          {message && <p role="alert" className="notice-error text-sm">{message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditingCourse(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save class"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(scheduleCourseId)} onOpenChange={(open) => { if (!open && !busy) setScheduleCourseId(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="text-xl font-semibold">{scheduleCourse?.name} meetings</DialogTitle><DialogDescription>Choose days together. Saving changed slots replaces their old weekly series and its individual exceptions.</DialogDescription></DialogHeader>
        <form onSubmit={saveMeetings} className="space-y-4">
          {groups.map((group, index) => <fieldset key={index} className="border-b border-border pb-4 last:border-0"><legend className="mb-2 font-medium">Meeting pattern {index + 1}</legend>
            <div className="flex flex-wrap gap-1.5" aria-label={`Days for meeting pattern ${index + 1}`}>{weekdays.map((day, at) => <label key={day} className="cursor-pointer"><input type="checkbox" className="sr-only peer" checked={group.days.includes(at + 1)} disabled={busy} onChange={(event) => updateGroup(index, { days: event.target.checked ? [...group.days, at + 1].sort() : group.days.filter((value) => value !== at + 1) })} /><span className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-input px-2 text-xs peer-checked:border-brand-ink peer-checked:bg-brand-200 peer-focus-visible:outline-2 peer-focus-visible:outline-ring">{day}</span></label>)}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="space-y-1"><Label htmlFor={`meeting-start-${index}`}>Start</Label><Input id={`meeting-start-${index}`} type="time" value={group.start} required disabled={busy} onChange={(event) => updateGroup(index, { start: event.target.value })} /></div><div className="space-y-1"><Label htmlFor={`meeting-end-${index}`}>End</Label><Input id={`meeting-end-${index}`} type="time" value={group.end} required disabled={busy} onChange={(event) => updateGroup(index, { end: event.target.value })} /></div><div className="space-y-1"><Label htmlFor={`meeting-location-${index}`}>Location</Label><Input id={`meeting-location-${index}`} maxLength={200} value={group.location} disabled={busy} onChange={(event) => updateGroup(index, { location: event.target.value })} placeholder="Room 210" /></div></div>
            <Button type="button" variant="ghost" className="mt-2 text-destructive" disabled={busy} onClick={() => setGroups((items) => items.filter((_, at) => at !== index))}>Remove pattern</Button>
          </fieldset>)}
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setGroups((items) => [...items, newGroup()])}>Add meeting time</Button>
          {groups.length === 0 && <p className="field-hint">No weekly class meetings. Add a time, or save to remove all meetings.</p>}
          {message && <p role="alert" className="notice-error text-sm">{message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => setScheduleCourseId(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save meetings"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(deletingCourse)} onOpenChange={(open) => { if (!open && !busy) setDeletingCourse(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete planner class?</AlertDialogTitle><AlertDialogDescription>“{deletingCourse?.name}” and its class meetings and exceptions will be deleted. A linked Hebacademy course and its study decks will stay.</AlertDialogDescription></AlertDialogHeader>{message && <p role="alert" className="notice-error text-sm">{message}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => void removeCourse()}>{busy ? "Deleting…" : "Delete class"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
