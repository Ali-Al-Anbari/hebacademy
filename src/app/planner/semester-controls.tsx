"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { isDateOnly, isTimeZone } from "@/lib/planner/dates";
import type { Semester, SemesterDraft } from "@/lib/planner/types";
import { deleteSemester, saveSemester, setSemesterArchived } from "./actions";

const empty = (): SemesterDraft => ({ name: "", start_date: "", end_date: "",
  time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });

export function SemesterControls({ semester, onSaved }: {
  semester: Semester | null;
  onSaved: (id?: string) => void;
}) {
  const inFlight = useRef(false);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<SemesterDraft>({ name: "", start_date: "", end_date: "", time_zone: "UTC" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function open(semesterToEdit: Semester | null) {
    setEditingId(semesterToEdit?.id ?? null);
    setDraft(semesterToEdit ? { name: semesterToEdit.name,
      start_date: semesterToEdit.start_date, end_date: semesterToEdit.end_date,
      time_zone: semesterToEdit.time_zone } : empty());
    setMessage("");
    setEditing(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!draft.name.trim() || !isDateOnly(draft.start_date) || !isDateOnly(draft.end_date)
      || draft.end_date < draft.start_date || !isTimeZone(draft.time_zone)) {
      setMessage("Enter a name, valid date range, and valid IANA time zone.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await saveSemester(editingId, draft);
      if (result.error) setMessage(result.error);
      else { setEditing(false); onSaved(result.id ?? undefined); }
    } catch { setMessage("Could not save the semester. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function archive(archived: boolean) {
    if (!semester || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await setSemesterArchived(semester.id, archived);
      if (result.error) setMessage(result.error);
      else onSaved();
    } catch { setMessage("Could not change the semester status."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function remove() {
    if (!semester || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteSemester(semester.id);
      if (result.error) setMessage(result.error);
      else { setDeleting(false); onSaved(); }
    } catch { setMessage("Could not delete the semester."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <>
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={() => open(null)}>{semester ? "New semester" : "Create your first semester"}</Button>
      {semester && <>
        <Button type="button" variant="secondary" onClick={() => open(semester)}>Edit semester</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void archive(!semester.archived_at)}>
          {semester.archived_at ? "Unarchive" : "Archive"}
        </Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>Delete</Button>
      </>}
    </div>
    {message && !editing && !deleting && <p role="alert" className="notice-error mt-3 text-sm">{message}</p>}
    <Dialog open={editing} onOpenChange={(open) => { if (!busy) setEditing(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="text-xl font-semibold">{editingId ? "Edit semester" : "New semester"}</DialogTitle>
          <DialogDescription>Set the academic dates and the time zone used for local class times.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="planner-semester-name">Name</Label><Input id="planner-semester-name" required maxLength={120} value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Fall 2026" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="planner-semester-start">Start date</Label><Input id="planner-semester-start" type="date" required value={draft.start_date} disabled={busy} onChange={(event) => setDraft({ ...draft, start_date: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="planner-semester-end">End date</Label><Input id="planner-semester-end" type="date" required value={draft.end_date} disabled={busy} onChange={(event) => setDraft({ ...draft, end_date: event.target.value })} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="planner-semester-zone">Time zone (IANA)</Label><Input id="planner-semester-zone" required value={draft.time_zone} disabled={busy} onChange={(event) => setDraft({ ...draft, time_zone: event.target.value })} placeholder="America/New_York" /><p className="field-hint">Class times stay at the entered local clock time.</p></div>
          {message && <p role="alert" className="notice-error text-sm">{message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save semester"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={deleting} onOpenChange={(open) => { if (!busy) setDeleting(open); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this semester permanently?</AlertDialogTitle>
        <AlertDialogDescription>All planner classes, meetings, exceptions, and future planner content in “{semester?.name}” will be deleted. Linked Hebacademy courses remain. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
        {message && <p role="alert" className="notice-error text-sm">{message}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete semester"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
