"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createCourse, deleteCourse, renameCourse } from "./course-actions";

type Course = { id: string; name: string };

export function CourseManager({ courses }: { courses: Course[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
    if (busy || !window.confirm(`Delete “${course.name}”? This cannot be undone.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteCourse(course.id);
      if (result.error) setMessage(result.error);
      else router.refresh();
    } catch {
      setMessage("Could not delete the course. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-9 flex justify-end">
        <button type="button" onClick={() => { setAdding(!adding); setMessage(""); }} disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 font-medium text-white hover:bg-teal-800 disabled:opacity-60">
          <span aria-hidden="true" className="text-xl leading-none">+</span>
          Add Course
        </button>
      </div>

      {adding && (
        <form onSubmit={add} className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <label htmlFor="new-course-name" className="block text-sm font-medium text-slate-700">Course name</label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input id="new-course-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} required autoFocus className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
            <button type="submit" disabled={busy} className="rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800 disabled:opacity-60">Save course</button>
          </div>
        </form>
      )}

      {message && <p role="alert" className="mt-4 text-sm text-red-700">{message}</p>}

      {courses.length === 0 ? (
        <div className="mt-9 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-slate-600">No courses yet. Add your first course to get started.</div>
      ) : (
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <div key={course.id} className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-teal-300 hover:shadow-md">
              <Link href={`/courses/${course.id}`} className="group flex min-h-40 flex-col justify-between p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
                <div>
                  <div className="mb-5 flex size-10 items-center justify-center rounded-lg bg-teal-50 text-lg font-semibold text-teal-700" aria-hidden="true">{course.name.charAt(0).toUpperCase()}</div>
                  <h2 className="break-words text-xl font-semibold text-slate-900 group-hover:text-teal-800">{course.name}</h2>
                </div>
                <div className="mt-5 flex items-center justify-between text-sm text-slate-500">
                  <span>0 decks</span>
                  <span aria-hidden="true" className="text-lg text-teal-700">→</span>
                </div>
              </Link>
              <div className="flex gap-2 border-t border-slate-100 px-6 py-3">
                <button type="button" disabled={busy} onClick={() => { setEditingId(course.id); setEditedName(course.name); setMessage(""); }} className="rounded-lg px-2 py-1 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60">Rename</button>
                <button type="button" disabled={busy} onClick={() => remove(course)} className="rounded-lg px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60">Delete</button>
              </div>
              {editingId === course.id && (
                <form onSubmit={rename} className="border-t border-slate-100 px-6 py-4">
                  <label htmlFor={`rename-${course.id}`} className="block text-sm font-medium text-slate-700">New name</label>
                  <input id={`rename-${course.id}`} value={editedName} onChange={(event) => setEditedName(event.target.value)} maxLength={120} required autoFocus className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
                  <div className="mt-3 flex gap-2">
                    <button type="submit" disabled={busy} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60">Save</button>
                    <button type="button" disabled={busy} onClick={() => setEditingId(null)} className="rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
