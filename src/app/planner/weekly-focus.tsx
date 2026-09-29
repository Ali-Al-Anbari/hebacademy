"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Ellipsis, Plus } from "lucide-react";
import { addDays, formatShortDate, formatWeekRange, getMondayOfWeek } from "@/lib/planner/dates";
import type { EffectiveAssignment, PlannerAssignment, PlannerCourse, PlannerWeeklyFocusItem, Semester } from "@/lib/planner/types";
import { addFreeformFocusItem, deleteWeeklyFocusItem, moveWeeklyFocusItem, pinAssignmentToFocus, reorderWeeklyFocusItems, saveWeeklyNotepad, toggleFreeformFocusItem, updateWeeklyFocusItemText } from "./focus-and-notes-actions";

type Props = {
  semester: Semester; weekStart: string; onWeekChange: (week: string) => void; today: string;
  courses: PlannerCourse[]; assignments: (PlannerAssignment | EffectiveAssignment)[];
  focusItems: PlannerWeeklyFocusItem[]; notepadBody: string;
  instanceId: string;
  onNotepadChange: (semesterId: string, weekStart: string, body: string) => void;
  onOpenAssignment: (assignment: PlannerAssignment | EffectiveAssignment) => void;
  onToggleAssignmentStatus: (assignment: PlannerAssignment | EffectiveAssignment) => void;
  onSaved: () => void;
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function WeekNotepad({ semesterId, weekStart, initialBody: body, instanceId, onChange }: { semesterId: string; weekStart: string; initialBody: string; instanceId: string; onChange: (semesterId: string, weekStart: string, body: string) => void }) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const version = useRef(0);
  const saved = useRef(body);
  const currentBody = useRef(body);
  const isVisible = () => instanceId === "desktop" ? window.matchMedia("(min-width: 1280px)").matches : !window.matchMedia("(min-width: 1280px)").matches;
  useEffect(() => () => {
    if (isVisible() && currentBody.current !== saved.current) {
      void saveWeeklyNotepad({ semesterId, weekStart, body: currentBody.current });
    }
    // The component is keyed by semester/week; cleanup retains this week's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semesterId, weekStart]);
  useEffect(() => {
    currentBody.current = body;
    if (body === saved.current || !isVisible()) return;
    const timer = window.setTimeout(async () => {
      const current = ++version.current;
      setStatus("saving");
      try {
        const result = await saveWeeklyNotepad({ semesterId, weekStart, body });
        if (current !== version.current) return;
        if (result.error) setStatus("error");
        else { saved.current = body; setStatus("saved"); }
      } catch { if (current === version.current) setStatus("error"); }
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, semesterId, weekStart]);
  return <div className="border-t border-[#ebd5dd] pt-3">
    <div className="mb-1 flex items-center justify-between gap-2"><label htmlFor={`weekly-notepad-${instanceId}`} className="text-xs font-bold text-ink">Week notes</label>
      <span role="status" className={`text-[10px] ${status === "error" ? "text-red-700" : "text-muted-foreground"}`}>{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Save failed — edit to retry" : ""}</span></div>
    <textarea id={`weekly-notepad-${instanceId}`} value={body} onChange={(event) => { currentBody.current = event.target.value; onChange(semesterId, weekStart, event.target.value); setStatus("idle"); }} maxLength={20000} rows={3} placeholder="Notes for this week…" className="min-h-18 max-h-44 w-full resize-y rounded-md border border-input bg-white px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-ink [field-sizing:content]" />
  </div>;
}

export function WeeklyFocus({ semester, weekStart, onWeekChange, today, courses, assignments, focusItems, notepadBody, instanceId, onNotepadChange, onOpenAssignment, onToggleAssignmentStatus, onSaved }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [pinId, setPinId] = useState("");
  const [addDayOffset, setAddDayOffset] = useState(() => weekStart === getMondayOfWeek(today) ? Math.max(0, DAYS.findIndex((_, index) => addDays(weekStart, index) === today)) : 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const editBusyRef = useRef(false);
  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const assignmentById = useMemo(() => new Map(assignments.map((assignment) => [assignment.id, assignment])), [assignments]);
  const weekItems = focusItems.filter((item) => item.semester_id === semester.id && item.week_start === weekStart);
  const weekDays = DAYS.map((name, index) => ({ name, date: addDays(weekStart, index) }));
  const addDate = weekDays[addDayOffset].date;
  const populatedDays = weekDays.map((day) => ({ ...day, items: weekItems.filter((item) => item.focus_date === day.date).sort((a, b) => a.position - b.position) })).filter((day) => day.items.length > 0);

  function assignmentForItem(item: PlannerWeeklyFocusItem) {
    if (!item.assignment_id) return null;
    if (item.occurrence_date) {
      const materialized = assignments.find((assignment) => assignment.parent_series_id === item.assignment_id && assignment.original_due_date === item.occurrence_date);
      if (materialized) return materialized;
      const root = assignmentById.get(item.assignment_id);
      if (root) return { ...root, id: `virtual:${root.id}:${item.occurrence_date}`, due_date: item.occurrence_date, original_due_date: item.occurrence_date, parent_series_id: root.id, isOccurrence: true, isVirtual: true, seriesRootId: root.id, originalOccurrenceDate: item.occurrence_date } as EffectiveAssignment;
    }
    return assignmentById.get(item.assignment_id) ?? null;
  }

  const incompleteCount = weekItems.filter((item) => item.assignment_id ? assignmentForItem(item)?.status !== "done" : !item.is_done).length;
  const pinned = new Set(weekItems.filter((item) => item.assignment_id).map((item) => `${item.assignment_id}:${item.occurrence_date ?? ""}`));
  const pinCandidates = assignments.filter((assignment) => !pinned.has(`${assignment.id}:${assignment.original_due_date ?? ""}`));

  async function addItem(event: FormEvent) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const result = await addFreeformFocusItem({ semesterId: semester.id, weekStart, focusDate: addDate, title });
      if (result.error) alert(result.error);
      else { setNewTitle(""); onSaved(); }
    } finally { setBusy(false); }
  }
  async function pinSelected() {
    if (!pinId || busy) return;
    setBusy(true);
    try {
      const result = await pinAssignmentToFocus({ semesterId: semester.id, weekStart, focusDate: addDate, assignmentId: pinId });
      if (result.error) alert(result.error);
      else { setPinPickerOpen(false); setPinId(""); onSaved(); }
    } finally { setBusy(false); }
  }
  async function changeItem(operation: () => Promise<{ error: string | null }>) {
    if (busy) return;
    setBusy(true);
    try { const result = await operation(); if (result.error) alert(result.error); else onSaved(); }
    catch { alert("Could not update Weekly Focus. Please try again."); }
    finally { setBusy(false); }
  }
  async function saveEdit(itemId: string) {
    if (editBusyRef.current) return;
    editBusyRef.current = true;
    setEditBusy(true);
    setEditError("");
    try {
      const result = await updateWeeklyFocusItemText(itemId, editText);
      if (result.error) setEditError(result.error);
      else { setEditingId(null); onSaved(); }
    } catch (error) {
      if (process.env.NODE_ENV === "development") console.error("Weekly Focus edit request failed", error);
      setEditError("Could not save the focus item. Please try again.");
    } finally { editBusyRef.current = false; setEditBusy(false); }
  }
  async function reorder(date: string, items: PlannerWeeklyFocusItem[], index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= items.length) return;
    const ordered = [...items];
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    await changeItem(() => reorderWeeklyFocusItems({ semesterId: semester.id, weekStart, focusDate: date, orderedIds: ordered.map((item) => item.id) }));
  }

  return <section className="planner-weekly-focus flex flex-col gap-3 rounded-xl border border-[#dabac4] bg-[#fffdfd] p-3.5" aria-label="Weekly Focus">
    <div className="flex items-start justify-between gap-2">
      <div><h2 className="text-sm font-bold text-ink">Weekly Focus {incompleteCount > 0 && <span className="text-xs font-normal text-muted-foreground">· {incompleteCount} open</span>}</h2><p className="text-xs text-muted-foreground">{formatWeekRange(weekStart)}</p></div>
      {weekStart !== getMondayOfWeek(today) && <button type="button" onClick={() => onWeekChange(getMondayOfWeek(today))} className="text-[11px] font-semibold text-brand-ink hover:underline">This week</button>}
    </div>
    <div className="flex items-center justify-between border-b border-[#ebd5dd] pb-2">
      <button type="button" onClick={() => onWeekChange(addDays(weekStart, -7))} aria-label="Previous week" className="rounded p-1 focus-visible:ring-2 focus-visible:ring-brand-ink"><ChevronLeft className="size-4" /></button>
      <button type="button" onClick={() => onWeekChange(addDays(weekStart, 7))} aria-label="Next week" className="rounded p-1 focus-visible:ring-2 focus-visible:ring-brand-ink"><ChevronRight className="size-4" /></button>
    </div>
    <div className="min-w-0">
      <form onSubmit={addItem} className="flex min-w-0 items-center gap-1">
        <textarea aria-label="New focus item" rows={1} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Type a focus item…" className="min-w-0 flex-1 resize-y rounded border border-input bg-white px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-brand-ink" />
        <select aria-label="Day for new focus item or assignment pin" value={addDayOffset} onChange={(event) => setAddDayOffset(Number(event.target.value))} className="w-12 shrink-0 rounded border border-input bg-white px-1 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-brand-ink">{weekDays.map((day, index) => <option key={day.date} value={index}>{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"][index]}</option>)}</select>
        <button type="submit" disabled={busy || !newTitle.trim()} aria-label="Add focus item" className="flex size-7 shrink-0 items-center justify-center rounded bg-brand-ink text-white disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-brand-ink"><Plus className="size-4" /></button>
      </form>
      <button type="button" onClick={() => { setPinPickerOpen((open) => !open); setPinId(""); }} className="mt-1 text-[11px] text-brand-ink hover:underline">+ Pin assignment to {weekDays[addDayOffset].name}</button>
      {pinPickerOpen && <div className="mt-1 flex gap-1"><select aria-label="Assignment to pin" value={pinId} onChange={(event) => setPinId(event.target.value)} className="min-w-0 flex-1 rounded border border-input bg-white p-1 text-xs"><option value="">Choose assignment</option>{pinCandidates.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.title}</option>)}</select><button type="button" onClick={pinSelected} disabled={!pinId || busy} className="rounded bg-brand-ink px-2 text-xs text-white disabled:opacity-50">Pin</button></div>}
    </div>
    {populatedDays.length === 0 && <p className="text-xs text-muted-foreground">No focus items this week. Add one or pin an assignment.</p>}
    <div className="space-y-3">
      {populatedDays.map((day) => <section key={day.date} aria-label={`${day.name} focus items`}>
        <h3 className="mb-0.5 text-xs font-bold text-ink">{day.name} <span className="font-normal text-muted-foreground">{formatShortDate(day.date)}</span></h3>
        <div>
        {day.items.map((item, index) => {
          const assignment = assignmentForItem(item);
          const course = assignment?.planner_course_id ? courseById.get(assignment.planner_course_id) : null;
          const done = assignment ? assignment.status === "done" : item.is_done;
          const displayText = item.title ?? assignment?.title ?? "Assignment unavailable";
          return <div key={item.id} className="flex min-w-0 items-start gap-2 border-b border-[#f0dce3] py-1.5 text-xs last:border-b-0">
            <button type="button" disabled={busy || editBusy} onClick={() => assignment ? onToggleAssignmentStatus(assignment) : changeItem(() => toggleFreeformFocusItem(item.id, item.is_done))} aria-label={done ? `Mark ${displayText} incomplete` : `Mark ${displayText} complete`} className="flex size-5 shrink-0 items-center justify-center rounded border border-[#d8b3c0] bg-white focus-visible:ring-2 focus-visible:ring-brand-ink">{done && <Check className="size-3" />}</button>
            <div className="min-w-0 flex-1">{editingId === item.id ? <div onPointerDown={(event) => event.stopPropagation()}>
                <textarea aria-label={`Edit ${displayText}`} rows={3} maxLength={500} value={editText} onChange={(event) => setEditText(event.target.value)} className="w-full resize-y rounded border border-input bg-white p-1.5 text-xs whitespace-pre-wrap [field-sizing:content] [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-brand-ink" />
                {editError && <p role="alert" className="mt-1 text-[11px] text-red-700">{editError}</p>}
                <div className="mt-1 flex justify-end gap-2"><button type="button" disabled={editBusy} onClick={() => { setEditingId(null); setEditError(""); }} className="rounded px-2 py-1 text-xs hover:bg-[#ffe5ec]">Cancel</button><button type="button" disabled={editBusy || !editText.trim()} onClick={() => void saveEdit(item.id)} className="rounded bg-brand-ink px-2 py-1 text-xs text-white disabled:opacity-50">{editBusy ? "Saving…" : "Save"}</button></div>
              </div> : assignment ? <button type="button" onClick={() => onOpenAssignment(assignment)} className={`block w-full whitespace-pre-wrap text-left font-medium [overflow-wrap:anywhere] hover:underline ${done ? "text-muted-foreground line-through" : "text-ink"}`}>{displayText}</button> : <span className={`block whitespace-pre-wrap [overflow-wrap:anywhere] ${done ? "text-muted-foreground line-through" : "text-ink"}`}>{displayText}</span>}
              {assignment && <div className="whitespace-pre-wrap text-[10px] text-muted-foreground [overflow-wrap:anywhere]">{course && <><span aria-hidden="true" className="mr-1 inline-block size-1.5 rounded-full" style={{ backgroundColor: course.color }} />{course.name} · </>}Due {formatShortDate(assignment.due_date)}</div>}</div>
            <details className="relative shrink-0"><summary aria-label={`Actions for ${displayText}`} className="flex size-6 cursor-pointer list-none items-center justify-center rounded text-muted-foreground hover:bg-[#ffe5ec] focus-visible:ring-2 focus-visible:ring-brand-ink [&::-webkit-details-marker]:hidden"><Ellipsis className="size-4" /></summary>
              <div className="absolute right-0 z-20 w-36 rounded-md border border-[#e5c5d0] bg-[#fffafd] p-1 shadow-sm">
                <button type="button" disabled={editBusy} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setEditingId(item.id); setEditText(displayText); setEditError(""); }} className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-[#ffe5ec]">Edit text</button>
                <button type="button" onClick={() => reorder(day.date, day.items, index, -1)} disabled={busy || index === 0} className="block w-full rounded px-2 py-1 text-left text-xs disabled:opacity-40 hover:bg-[#ffe5ec]">Move up</button>
                <button type="button" onClick={() => reorder(day.date, day.items, index, 1)} disabled={busy || index === day.items.length - 1} className="block w-full rounded px-2 py-1 text-left text-xs disabled:opacity-40 hover:bg-[#ffe5ec]">Move down</button>
                <label className="block px-2 pt-1 text-[10px] text-muted-foreground">Move to day<select aria-label={`Move ${assignment?.title ?? item.title} to day`} value={day.date} disabled={busy} onChange={(event) => changeItem(() => moveWeeklyFocusItem(item.id, event.target.value))} className="mt-0.5 w-full rounded border border-input bg-white p-1 text-xs">{weekDays.map((targetDay) => <option key={targetDay.date} value={targetDay.date}>{targetDay.name}</option>)}</select></label>
                <button type="button" disabled={busy} onClick={() => changeItem(() => deleteWeeklyFocusItem(item.id))} className="mt-1 block w-full rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50">{assignment ? "Remove pin" : "Delete"}</button>
              </div>
            </details>
          </div>;
        })}
      </div>
      </section>)}
    </div>
    <WeekNotepad key={`${semester.id}:${weekStart}`} semesterId={semester.id} weekStart={weekStart} initialBody={notepadBody} instanceId={instanceId} onChange={onNotepadChange} />
  </section>;
}
