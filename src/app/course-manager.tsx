"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MoreHorizontal, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCourse, deleteCourse, renameCourse } from "./course-actions";

type Course = { id: string; name: string; deckCount: number };

export function CourseManager({ courses }: { courses: Course[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<Course | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await createCourse(newName);
      if (result.error) setMessage(result.error);
      else {
        setNewName("");
        setAdding(false);
        router.refresh();
      }
    } catch {
      setMessage("Could not add the course. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editingId) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await renameCourse(editingId, editedName);
      if (result.error) setMessage(result.error);
      else {
        setEditingId(null);
        router.refresh();
      }
    } catch {
      setMessage("Could not rename the course. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(course: Course) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteCourse(course.id);
      if (result.error) setMessage(result.error);
      else { setDeleting(null); router.refresh(); }
    } catch {
      setMessage("Could not delete the course. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="page-intro flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="page-title">Your courses</h1><p className="page-description">Pick a course to continue studying.</p></div>
      <Button type="button" onClick={() => { setAdding(true); setMessage(""); }} className="w-full sm:w-auto"><Plus /> Add Course</Button>
    </div>
    {message && <p role="alert" className="notice-error mt-4 text-sm">{message}</p>}
    {courses.length === 0 ? <div className="empty-panel mt-5"><h2 className="empty-panel__title">No courses yet</h2><p className="empty-panel__copy">Create a course to organize your decks.</p></div> :
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{courses.map((course) => <Card key={course.id} className="min-w-0 py-0 transition-colors hover:border-[#c9a1b1]"><CardContent className="flex items-start gap-2 p-5"><Link href={`/courses/${course.id}`} className="min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><h2 className="break-words text-base font-semibold text-foreground hover:text-primary">{course.name}</h2><p className="mt-2 text-sm text-muted-foreground">{course.deckCount} {course.deckCount === 1 ? "deck" : "decks"}</p></Link><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Manage ${course.name}`} className="-mr-2 -mt-2 text-muted-foreground" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-40"><DropdownMenuItem onClick={() => { setEditingId(course.id); setEditedName(course.name); setMessage(""); }}><Pencil /> Rename</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setDeleting(course)}><Trash2 /> Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></CardContent></Card>)}</div>}
    <Dialog open={adding} onOpenChange={(open) => { if (!busy) setAdding(open); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="text-xl font-semibold">Create a course</DialogTitle><DialogDescription>Give this subject a name. You can add decks inside it next.</DialogDescription></DialogHeader><form onSubmit={add} className="space-y-5"><div className="space-y-2"><Label htmlFor="new-course-name">Course name</Label><Input id="new-course-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} required autoFocus placeholder="e.g. Ocular Anatomy" /></div>{message && <p role="alert" className="notice-error text-sm">{message}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create course"}</Button></div></form></DialogContent></Dialog>
    <Dialog open={Boolean(editingId)} onOpenChange={(open) => { if (!open && !busy) setEditingId(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="text-xl font-semibold">Rename course</DialogTitle><DialogDescription>Update the name shown on your dashboard.</DialogDescription></DialogHeader><form onSubmit={rename} className="space-y-5"><div className="space-y-2"><Label htmlFor="edit-course-name">Course name</Label><Input id="edit-course-name" value={editedName} onChange={(event) => setEditedName(event.target.value)} maxLength={120} required autoFocus /></div>{message && <p role="alert" className="notice-error text-sm">{message}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditingId(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button></div></form></DialogContent></Dialog>
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this course?</AlertDialogTitle><AlertDialogDescription>“{deleting?.name}” and everything in it will be deleted. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>{message && <p role="alert" className="notice-error text-sm">{message}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => { if (deleting) void remove(deleting); }}>{busy ? "Deleting…" : "Delete course"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
