"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Archive, Pencil, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCalendarDate, isCalendarDate, type ScheduleSelectionMode } from "@/lib/schedules";
import { deleteSchedule, setScheduleArchived, updateSchedule } from "../actions";

type Card = { id: string; prompt: string; is_starred: boolean };
type DateRow = { id: string; review_date: string; completed: boolean };
type DateDraft = { key: string; id: string | null; review_date: string; completed: boolean };

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function ScheduleManager({ schedule, courseName, deckName, cards, selectedCardIds, dates }: {
  schedule: { id: string; name: string; description: string | null; examDate: string | null; archived: boolean };
  courseName: string;
  deckName: string;
  cards: Card[];
  selectedCardIds: string[];
  dates: DateRow[];
}) {
  const router = useRouter();
  const submitting = useRef(false);
  const nextDateKey = useRef(0);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(schedule.name);
  const [description, setDescription] = useState(schedule.description ?? "");
  const [examDate, setExamDate] = useState(schedule.examDate ?? "");
  const [mode, setMode] = useState<ScheduleSelectionMode>("manual");
  const [manualIds, setManualIds] = useState<string[]>(selectedCardIds);
  const [dateDrafts, setDateDrafts] = useState<DateDraft[]>(dates.map((date) => ({
    key: date.id, id: date.id, review_date: date.review_date, completed: date.completed,
  })));
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectedSet = new Set(selectedCardIds);
  const selectedCards = cards.filter((card) => selectedSet.has(card.id));
  const selectedCount = mode === "all" ? cards.length
    : mode === "starred" ? cards.filter((card) => card.is_starred).length
      : manualIds.length;
  const afterExam = Boolean(examDate && isCalendarDate(examDate)
    && dateDrafts.some((date) => date.review_date > examDate));

  function beginEdit() {
    setName(schedule.name);
    setDescription(schedule.description ?? "");
    setExamDate(schedule.examDate ?? "");
    setMode("manual");
    setManualIds(selectedCardIds);
    setDateDrafts(dates.map((date) => ({
      key: date.id, id: date.id, review_date: date.review_date, completed: date.completed,
    })));
    setNewDate("");
    setMessage("");
    setEditing(true);
  }

  function addDate() {
    if (!isCalendarDate(newDate) || newDate < localToday()) {
      setMessage("Choose today or a future review date.");
      return;
    }
    if (dateDrafts.some((date) => date.review_date === newDate)) {
      setMessage("That review date is already on this schedule.");
      return;
    }
    const key = `new-${++nextDateKey.current}`;
    setDateDrafts((current) => [...current, { key, id: null, review_date: newDate, completed: false }]
      .sort((a, b) => a.review_date.localeCompare(b.review_date)));
    setNewDate("");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitting.current) return;
    setMessage("");
    if (!name.trim() || name.trim().length > 120) {
      setMessage("Enter a schedule name of 1 to 120 characters.");
      return;
    }
    if (examDate && !isCalendarDate(examDate)) {
      setMessage("Enter a valid exam date or leave it blank.");
      return;
    }
    if (newDate) {
      setMessage("Add or clear the pending review date before saving.");
      return;
    }
    if (dateDrafts.some((date) => !isCalendarDate(date.review_date))
        || new Set(dateDrafts.map((date) => date.review_date)).size !== dateDrafts.length) {
      setMessage("Review dates must be valid and unique.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await updateSchedule(schedule.id, {
        name, description, examDate, selectionMode: mode,
        manualCardIds: manualIds,
        reviewDates: dateDrafts.map(({ id, review_date }) => ({ id, review_date })),
      });
      if (result.error) setMessage(result.error);
      else {
        setEditing(false);
        router.refresh();
      }
    } catch {
      setMessage("Could not confirm whether every change saved. Your edits are still here; refresh and review before retrying.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await setScheduleArchived(schedule.id, !schedule.archived);
      if (result.error) setMessage(result.error);
      else router.refresh();
    } catch {
      setMessage("Could not change the schedule status. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteSchedule(schedule.id);
      if (result.error) setMessage(result.error);
      else router.push("/");
    } catch {
      setMessage("Could not delete the schedule. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="surface-panel mt-5 space-y-7">
        <div><h1 className="page-title">Edit schedule</h1><p className="page-description">{courseName} · {deckName}. This deck cannot be changed.</p></div>
        <section className="space-y-4" aria-labelledby="edit-details-heading">
          <h2 id="edit-details-heading" className="section-title">Details</h2>
          <div className="space-y-2"><Label htmlFor="edit-schedule-name">Schedule name</Label><Input id="edit-schedule-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} disabled={busy} /></div>
          <div className="space-y-2"><Label htmlFor="edit-schedule-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="edit-schedule-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={busy} rows={3} /></div>
          <div className="space-y-2"><Label htmlFor="edit-exam-date">Exam date <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="edit-exam-date" type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} disabled={busy} /></div>
        </section>
        <section className="space-y-4 border-t border-border pt-6" aria-labelledby="edit-cards-heading">
          <div><h2 id="edit-cards-heading" className="section-title">Selected cards</h2><p className="page-description mt-1">Save actual card IDs from this deck. Newly added or starred cards will not join the schedule automatically.</p></div>
          <fieldset disabled={busy} className="space-y-2"><legend className="sr-only">Card selection method</legend>{([ ["all", "Entire deck"], ["starred", "Starred cards"], ["manual", "Manual selection"] ] as const).map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 has-checked:border-primary has-checked:bg-secondary/50"><input type="radio" name="edit-card-mode" checked={mode === value} onChange={() => setMode(value)} className="accent-primary" /><span className="font-medium">{label}</span></label>)}</fieldset>
          {mode === "manual" && (cards.length ? <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2">{cards.map((card) => <label key={card.id} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/60"><input type="checkbox" disabled={busy} checked={manualIds.includes(card.id)} onChange={(event) => setManualIds((ids) => event.target.checked ? [...ids, card.id] : ids.filter((id) => id !== card.id))} className="mt-1 accent-primary" /><span className="min-w-0 break-words text-sm">{card.prompt}{card.is_starred && <span className="ml-2 text-xs text-muted-foreground">★ Starred</span>}</span></label>)}</div> : <p className="field-hint">This deck has no cards.</p>)}
          <p aria-live="polite" className="text-sm font-medium">{selectedCount} {selectedCount === 1 ? "card" : "cards"} selected. Zero cards is allowed.</p>
        </section>
        <section className="space-y-4 border-t border-border pt-6" aria-labelledby="edit-dates-heading">
          <div><h2 id="edit-dates-heading" className="section-title">Review dates</h2><p className="page-description mt-1">Completed dates are locked. Incomplete dates can be changed or removed.</p></div>
          {dateDrafts.length ? <ul className="space-y-2">{dateDrafts.map((date) => <li key={date.key} className="flex flex-col gap-2 rounded-md border border-border bg-white p-3 sm:flex-row sm:items-center"><div className="flex-1"><Label htmlFor={`date-${date.key}`} className="sr-only">Review date</Label><Input id={`date-${date.key}`} type="date" value={date.review_date} disabled={busy || date.completed} onChange={(event) => setDateDrafts((current) => current.map((item) => item.key === date.key ? { ...item, review_date: event.target.value } : item))} /></div>{date.completed ? <Badge variant="secondary">Completed · locked</Badge> : <Button type="button" variant="ghost" disabled={busy} onClick={() => setDateDrafts((current) => current.filter((item) => item.key !== date.key))}>Remove</Button>}</li>)}</ul> : <p className="field-hint">No review dates selected.</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><div className="flex-1 space-y-2"><Label htmlFor="new-review-date">Add review date</Label><Input id="new-review-date" type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} disabled={busy} /></div><Button type="button" variant="secondary" disabled={busy} onClick={addDate}>Add date</Button></div>
          {afterExam && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Some review dates are after the exam date. You can still save.</p>}
        </section>
        {message && <p role="alert" className="notice-error text-sm">{message}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => { setEditing(false); setMessage(""); }}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save schedule"}</Button></div>
      </form>
    );
  }

  const incompleteDates = dates.filter((date) => !date.completed);
  const completedDates = dates.filter((date) => date.completed);
  return (
    <>
      <div className="page-intro mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="flex items-center gap-2"><p className="page-eyebrow">Study schedule</p><Badge variant="secondary">{schedule.archived ? "Archived" : "Active"}</Badge></div><h1 className="page-title">{schedule.name}</h1><p className="page-description">{courseName} · {deckName}</p></div>
        <Button type="button" onClick={beginEdit} className="w-full sm:w-auto"><Pencil /> Edit Schedule</Button>
      </div>
      {schedule.description && <p className="mt-5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{schedule.description}</p>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="surface-panel"><p className="text-sm text-muted-foreground">Selected cards</p><p className="mt-2 text-xl font-semibold tabular-nums">{selectedCardIds.length}</p></div><div className="surface-panel"><p className="text-sm text-muted-foreground">Exam date</p><p className="mt-2 text-base font-semibold">{schedule.examDate ? formatCalendarDate(schedule.examDate) : "No exam date"}</p></div></div>
      <section className="mt-8" aria-labelledby="schedule-review-dates"><h2 id="schedule-review-dates" className="section-title">Review dates</h2><div className="mt-3 grid gap-4 sm:grid-cols-2"><div><h3 className="text-sm font-semibold text-foreground">Scheduled</h3>{incompleteDates.length ? <ul className="mt-2 space-y-2">{incompleteDates.map((date) => <li key={date.id} className="rounded-md border border-border bg-white px-3 py-2 text-sm">{formatCalendarDate(date.review_date)}</li>)}</ul> : <p className="field-hint mt-2">No incomplete dates.</p>}</div><div><h3 className="text-sm font-semibold text-foreground">Completed</h3>{completedDates.length ? <ul className="mt-2 space-y-2">{completedDates.map((date) => <li key={date.id} className="rounded-md border border-border bg-white px-3 py-2 text-sm">{formatCalendarDate(date.review_date)}</li>)}</ul> : <p className="field-hint mt-2">No completed dates yet.</p>}</div></div></section>
      <section className="mt-8" aria-labelledby="selected-schedule-cards"><h2 id="selected-schedule-cards" className="section-title">Selected cards</h2>{selectedCards.length ? <ul className="mt-3 space-y-2">{selectedCards.map((card) => <li key={card.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-white px-4 py-3 text-sm"><span className="min-w-0 whitespace-pre-wrap break-words">{card.prompt}</span>{card.is_starred && <span className="shrink-0 text-xs text-muted-foreground">★ Starred</span>}</li>)}</ul> : <p className="page-description mt-2">No cards selected. Use Edit Schedule to add cards.</p>}</section>
      {message && <p role="alert" className="notice-error mt-6 text-sm">{message}</p>}
      <div className="mt-8 flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:flex-wrap"><Button render={<Link href="/" />} variant="secondary">Back to Dashboard</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => void toggleArchive()}><Archive /> {schedule.archived ? "Unarchive" : "Archive"}</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 /> Delete schedule</Button></div>
      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!busy) setConfirmDelete(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this schedule?</AlertDialogTitle><AlertDialogDescription>“{schedule.name}” and its planned dates will be removed. Existing study sessions and card review history are preserved. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete schedule"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  );
}
