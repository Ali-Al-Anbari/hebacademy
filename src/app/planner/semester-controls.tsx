"use client";

import { useRef, useState, type FormEvent } from "react";
import { Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isDateOnly, isTimeZone } from "@/lib/planner/dates";
import type { Semester, SemesterDraft } from "@/lib/planner/types";
import { deleteSemester, saveSemester, setSemesterArchived } from "./actions";

const empty = (): SemesterDraft => ({
  name: "",
  start_date: "",
  end_date: "",
  time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
});

export function SemesterControls({
  semester,
  onSaved,
}: {
  semester: Semester | null;
  onSaved: (id?: string) => void;
}) {
  const inFlight = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<SemesterDraft>({
    name: "",
    start_date: "",
    end_date: "",
    time_zone: "UTC",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function open(semesterToEdit: Semester | null) {
    setEditingId(semesterToEdit?.id ?? null);
    setDraft(
      semesterToEdit
        ? {
            name: semesterToEdit.name,
            start_date: semesterToEdit.start_date,
            end_date: semesterToEdit.end_date,
            time_zone: semesterToEdit.time_zone,
          }
        : empty()
    );
    setMessage("");
    setSettingsOpen(false);
    setEditing(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (
      !draft.name.trim() ||
      !isDateOnly(draft.start_date) ||
      !isDateOnly(draft.end_date) ||
      draft.end_date < draft.start_date ||
      !isTimeZone(draft.time_zone)
    ) {
      setMessage("Enter a name, valid date range, and valid IANA time zone.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await saveSemester(editingId, draft);
      if (result.error) {
        setMessage(result.error);
      } else {
        setEditing(false);
        onSaved(result.id ?? undefined);
      }
    } catch {
      setMessage("Could not save the semester. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function archive(archived: boolean) {
    if (!semester || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await setSemesterArchived(semester.id, archived);
      if (result.error) {
        setMessage(result.error);
      } else {
        setSettingsOpen(false);
        onSaved();
      }
    } catch {
      setMessage("Could not change the semester status.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (!semester || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteSemester(semester.id);
      if (result.error) {
        setMessage(result.error);
      } else {
        setDeleting(false);
        setSettingsOpen(false);
        onSaved();
      }
    } catch {
      setMessage("Could not delete the semester.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {semester ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSettingsOpen(true)}
          className="h-8 px-2.5 text-xs font-semibold text-muted-foreground hover:text-ink hover:bg-[#fff0f4] gap-1.5"
          title="Semester settings"
        >
          <Settings className="size-3.5" />
          <span>Semester settings</span>
        </Button>
      ) : (
        <Button type="button" onClick={() => open(null)}>
          Create your first semester
        </Button>
      )}

      {message && !editing && !deleting && !settingsOpen && (
        <p role="alert" className="notice-error mt-3 text-sm">
          {message}
        </p>
      )}

      {/* Compact Semester Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Semester Settings</DialogTitle>
            <DialogDescription>
              Manage academic dates, time zone, or archive this semester.
            </DialogDescription>
          </DialogHeader>

          {semester && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border border-[#ebd5dd] bg-[#fff9fb] p-3 text-xs space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Semester</span>
                  <span className="font-bold text-[#2A2024]">{semester.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Dates</span>
                  <span className="font-semibold text-[#2A2024]">{semester.start_date} – {semester.end_date}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Time zone</span>
                  <span className="font-semibold text-[#2A2024]">{semester.time_zone}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Status</span>
                  <span className={`font-semibold ${semester.archived_at ? "text-amber-700" : "text-emerald-700"}`}>
                    {semester.archived_at ? "Archived" : "Active"}
                  </span>
                </div>
              </div>

              {message && <p role="alert" className="notice-error text-xs">{message}</p>}

              <div className="flex flex-col gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => open(semester)}
                  className="w-full justify-start text-xs font-semibold"
                >
                  Edit semester dates & time zone
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void archive(!semester.archived_at)}
                  className="w-full justify-start text-xs font-semibold"
                >
                  {semester.archived_at ? "Unarchive semester" : "Archive semester"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => open(null)}
                  className="w-full justify-start text-xs font-semibold text-brand-ink"
                >
                  <Plus className="size-3.5 mr-1.5" />
                  Create another semester
                </Button>

                <div className="border-t border-border/80 pt-2 mt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setSettingsOpen(false);
                      setDeleting(true);
                    }}
                    className="w-full justify-start text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    Delete semester
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit / New Semester Dialog */}
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!busy) setEditing(open);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              {editingId ? "Edit semester" : "New semester"}
            </DialogTitle>
            <DialogDescription>
              Set the academic dates and the time zone used for local class times.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="planner-semester-name">Name</Label>
              <Input
                id="planner-semester-name"
                required
                maxLength={120}
                value={draft.name}
                disabled={busy}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Fall 2026"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="planner-semester-start">Start date</Label>
                <Input
                  id="planner-semester-start"
                  type="date"
                  required
                  value={draft.start_date}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({ ...draft, start_date: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planner-semester-end">End date</Label>
                <Input
                  id="planner-semester-end"
                  type="date"
                  required
                  value={draft.end_date}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({ ...draft, end_date: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="planner-semester-zone">Time zone (IANA)</Label>
              <Input
                id="planner-semester-zone"
                required
                value={draft.time_zone}
                disabled={busy}
                onChange={(event) =>
                  setDraft({ ...draft, time_zone: event.target.value })
                }
                placeholder="America/New_York"
              />
              <p className="field-hint">
                Class times stay at the entered local clock time.
              </p>
            </div>
            {message && <p role="alert" className="notice-error text-sm">{message}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save semester"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog
        open={deleting}
        onOpenChange={(open) => {
          if (!busy) setDeleting(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this semester permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              All planner classes, meetings, exceptions, and future planner content in “
              {semester?.name}” will be deleted. Linked Hebacademy courses remain. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {message && <p role="alert" className="notice-error text-sm">{message}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "Deleting…" : "Delete semester"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
