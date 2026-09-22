"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createDeck, deleteDeck, updateDeck } from "./deck-actions";

type Deck = { id: string; name: string; description: string | null };

export function DeckManager({ courseId, decks }: { courseId: string; decks: Deck[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await createDeck(courseId, name, description);
      if (result.error) setMessage(result.error);
      else {
        setName("");
        setDescription("");
        setAdding(false);
        router.refresh();
      }
    } catch {
      setMessage("Could not add the deck. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editingId) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await updateDeck(courseId, editingId, name, description);
      if (result.error) setMessage(result.error);
      else {
        setEditingId(null);
        router.refresh();
      }
    } catch {
      setMessage("Could not save the deck. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(deck: Deck) {
    if (busy || !window.confirm(`Delete “${deck.name}”? This cannot be undone.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteDeck(courseId, deck.id);
      if (result.error) setMessage(result.error);
      else router.refresh();
    } catch {
      setMessage("Could not delete the deck. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function startEditing(deck: Deck) {
    setAdding(false);
    setEditingId(deck.id);
    setName(deck.name);
    setDescription(deck.description ?? "");
    setMessage("");
  }

  return (
    <>
      <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Decks</h2>
          <p className="mt-1 text-sm text-slate-500">{decks.length} {decks.length === 1 ? "deck" : "decks"} in this course</p>
        </div>
        <button type="button" disabled={busy} onClick={() => { setEditingId(null); setAdding(!adding); setName(""); setDescription(""); setMessage(""); }} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-5 font-medium disabled:cursor-wait disabled:opacity-60 sm:w-auto ${adding ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "bg-teal-700 text-white hover:bg-teal-800"}`}>
          <span aria-hidden="true" className="text-xl leading-none">{adding ? "×" : "+"}</span>
          {adding ? "Close form" : "Add Deck"}
        </button>
      </div>

      {adding && (
        <form onSubmit={add} className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">New Deck</h3>
          <label htmlFor="new-deck-name" className="block text-sm font-medium text-slate-700">Deck name</label>
          <input id="new-deck-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required autoFocus className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
          <label htmlFor="new-deck-description" className="mt-4 block text-sm font-medium text-slate-700">Description (optional)</label>
          <textarea id="new-deck-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
          <button type="submit" disabled={busy} className="mt-4 min-h-11 w-full rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-60 sm:w-auto">{busy ? "Saving…" : "Save deck"}</button>
        </form>
      )}

      {message && <p role="alert" className="mt-4 text-sm text-red-700">{message}</p>}

      {decks.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-slate-600">No decks yet.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck, index) => (
            <div key={deck.id} className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-teal-300 hover:shadow-md">
              <Link href={`/courses/${courseId}/decks/${deck.id}`} className="group block p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
                <div className="mb-6 flex size-10 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-600" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
                <h3 className="break-words text-lg font-semibold text-slate-900 group-hover:text-teal-800">{deck.name}</h3>
                <p className="mt-1 line-clamp-3 break-words text-sm text-slate-500">{deck.description || "No description"}</p>
              </Link>
              <div className="flex gap-2 border-t border-slate-100 px-6 py-3">
                <button type="button" disabled={busy} onClick={() => startEditing(deck)} className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60">Edit</button>
                <button type="button" disabled={busy} onClick={() => remove(deck)} className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60">Delete</button>
              </div>
              {editingId === deck.id && (
                <form onSubmit={save} className="border-t border-slate-100 px-6 py-4">
                  <label htmlFor={`deck-name-${deck.id}`} className="block text-sm font-medium text-slate-700">Deck name</label>
                  <input id={`deck-name-${deck.id}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required autoFocus className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
                  <label htmlFor={`deck-description-${deck.id}`} className="mt-3 block text-sm font-medium text-slate-700">Description (optional)</label>
                  <textarea id={`deck-description-${deck.id}`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
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
