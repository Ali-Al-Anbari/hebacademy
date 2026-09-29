"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { GripVertical, Pencil, StickyNote, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { persistStickyTextDraft, sameStickyNoteContent, stickyNoteSavePayload, stickyNoteTextChanged } from "@/lib/sticky-note-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Color = "yellow" | "pink" | "blue" | "green" | "purple";
type Note = { id: string; title: string; body: string; color: Color; x: number; y: number; width: number; height: number; is_open: boolean; created_at: string; updated_at: string };
type NoteDraft = Pick<Note, "title" | "body">;
export type StickyNoteRecord = Note;
const noteLabel = (note: Note) => note.title.trim() || `Note (${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(note.created_at))})`;
const COLORS: Record<Color, string> = { yellow: "#fff2bd", pink: "#ffe0e9", blue: "#dcecf9", green: "#e0f1d8", purple: "#e9e2f8" };
const SIZE = { width: 260, height: 220 };
const clamp = (note: Note): Note => {
  if (typeof window === "undefined") return note;
  const width = Math.min(Math.max(220, note.width), 1200, Math.max(220, window.innerWidth - 16));
  const height = Math.min(Math.max(140, note.height), 1000, Math.max(140, window.innerHeight - 16));
  return { ...note, width, height, x: Math.max(0, Math.min(note.x, window.innerWidth - width)), y: Math.max(0, Math.min(note.y, window.innerHeight - height)) };
};

function FloatingNote({ note, top, error, titleSupported, isSaved, onChange, onCommit, onSaveDraft, onDiscardDraft, onFocus, onClose }: {
  note: Note; top: number; error?: string; titleSupported: boolean; isSaved: boolean;
  onChange: (note: Note, persist?: boolean) => void; onCommit: (noteId: string) => void;
  onSaveDraft: (noteId: string, draft: NoteDraft) => Promise<boolean>; onFocus: () => void;
  onDiscardDraft: (noteId: string) => void;
  onClose: (draft: NoteDraft | null) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [editing, setEditing] = useState(!isSaved);
  const [draft, setDraft] = useState<NoteDraft>({ title: note.title, body: note.body });
  const [savingDraft, setSavingDraft] = useState(false);
  const savingDraftRef = useRef(false);
  const origin = useRef<{ x: number; y: number; note: Note } | null>(null);
  const latest = useRef(note);
  useEffect(() => { latest.current = note; }, [note]);
  const noteRef = useRef<HTMLDivElement>(null);
  const draftChanged = stickyNoteTextChanged(draft, note);
  async function saveDraft() {
    if (savingDraftRef.current || !titleSupported && draft.title) return;
    savingDraftRef.current = true;
    setSavingDraft(true);
    try {
      if (await onSaveDraft(note.id, draft)) setEditing(false);
    } finally { savingDraftRef.current = false; setSavingDraft(false); }
  }
  function begin(event: ReactPointerEvent, kind: "move" | "resize") {
    if (event.button !== 0) return;
    event.preventDefault();
    onFocus();
    origin.current = { x: event.clientX, y: event.clientY, note };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === "move") setMoving(true); else setResizing(true);
  }
  function pointerMove(event: ReactPointerEvent, kind: "move" | "resize") {
    if (!origin.current) return;
    const { x, y, note: start } = origin.current;
    const changed = kind === "move"
      ? { ...start, x: start.x + event.clientX - x, y: start.y + event.clientY - y }
      : { ...start, width: start.width + event.clientX - x, height: start.height + event.clientY - y };
    onChange(clamp(changed));
  }
  function end() {
    if (!origin.current) return;
    origin.current = null;
    setMoving(false); setResizing(false);
    onCommit(latest.current.id);
  }
  return <div ref={noteRef} className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-md border border-[#78656b]/25 text-[#241c20] shadow-[0_5px_18px_#241c2025]" style={{ left: note.x, top: note.y, width: note.width, height: note.height, background: COLORS[note.color], zIndex: top + 1 }} onPointerDown={onFocus}>
    <div className={`flex h-9 shrink-0 items-center gap-1 border-b border-[#241c20]/10 px-2 ${moving ? "cursor-grabbing" : ""}`}>
      <div aria-label="Drag sticky note" title="Drag note" className="flex h-full w-5 shrink-0 cursor-grab touch-none items-center text-[#51434a]" onPointerDown={(event) => begin(event, "move")} onPointerMove={(event) => pointerMove(event, "move")} onPointerUp={end} onPointerCancel={end}><GripVertical className="size-4" /></div>
      {editing && titleSupported ? <input aria-label="Note title" maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={noteLabel(note)} className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none placeholder:text-[#51434a] focus-visible:ring-2 focus-visible:ring-[#241c20]" /> : <span className="min-w-0 flex-1 truncate text-xs font-semibold">{noteLabel(note)}</span>}
      {!editing && <button type="button" aria-label="Edit sticky note" onClick={() => { setDraft({ title: note.title, body: note.body }); setEditing(true); }} className="rounded p-1 hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-[#241c20]"><Pencil className="size-3.5" /></button>}
      <button type="button" aria-label="Close sticky note" disabled={savingDraft} onClick={() => onClose(editing ? draft : null)} className="rounded p-1 hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-[#241c20]"><X className="size-4" /></button>
    </div>
    {editing ? <textarea aria-label="Sticky note text" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="Write a note…" className="min-h-0 flex-1 resize-none bg-transparent p-3 text-sm leading-relaxed outline-none placeholder:text-[#63525a]" /> : <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-3 text-sm leading-relaxed [overflow-wrap:anywhere]">{note.body}</div>}
    {editing && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#241c20]/10 px-2 py-1 text-xs">
      {isSaved && <button type="button" disabled={savingDraft} onClick={() => { setDraft({ title: note.title, body: note.body }); onDiscardDraft(note.id); setEditing(false); }} className="rounded px-1.5 py-1 hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-[#241c20]">Discard</button>}
      <button type="button" disabled={savingDraft || isSaved && !draftChanged} onClick={() => void saveDraft()} className="rounded bg-[#241c20] px-2 py-1 font-semibold text-white disabled:opacity-50">{savingDraft ? "Saving…" : isSaved ? "Save" : "Create"}</button>
    </div>}
    <div className="flex h-7 shrink-0 items-center gap-1 border-t border-[#241c20]/10 px-2">
      {(Object.keys(COLORS) as Color[]).map((color) => <button key={color} type="button" aria-label={`Set note color to ${color}`} aria-pressed={note.color === color} onClick={() => onChange({ ...note, color }, true)} className={`size-4 rounded-full border border-[#241c20]/25 focus-visible:ring-2 focus-visible:ring-[#241c20] ${note.color === color ? "ring-1 ring-[#241c20]" : ""}`} style={{ background: COLORS[color] }} />)}
      <button type="button" onClick={() => onChange(clamp({ ...note, x: 8, y: 88 }), true)} className="ml-auto text-[10px] underline">Move into view</button>
      <button type="button" aria-label="Resize note with arrow keys or drag" title="Drag or use arrow keys to resize" className={`h-5 w-5 cursor-nwse-resize touch-none border-r-2 border-b-2 border-[#241c20]/35 focus-visible:ring-2 focus-visible:ring-[#241c20] ${resizing ? "opacity-70" : ""}`} onPointerDown={(event) => begin(event, "resize")} onPointerMove={(event) => pointerMove(event, "resize")} onPointerUp={end} onPointerCancel={end} onKeyDown={(event) => { const dx = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0; const dy = event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0; if (dx || dy) { event.preventDefault(); onChange(clamp({ ...note, width: note.width + dx, height: note.height + dy }), true); } }} />
    </div>
    {error && <span role="alert" className="px-2 pb-1 text-[10px] text-red-800">{error}</span>}
  </div>;
}

export function StickyNotes({ userId, initialNotes, initialError = false, titleSupported = true }: { userId: string; initialNotes: Note[]; initialError?: boolean; titleSupported?: boolean }) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const notesRef = useRef<Note[]>(initialNotes);
  const [ready, setReady] = useState(false);
  const [sameUser, setSameUser] = useState(true);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closingWasSaved, setClosingWasSaved] = useState(false);
  const [closingDraft, setClosingDraft] = useState<NoteDraft | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(initialError ? "Could not load saved sticky notes. Refresh and try again." : "");
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [front, setFront] = useState<string[]>(initialNotes.map((note) => note.id));
  const [savedNoteIds, setSavedNoteIds] = useState(() => new Set(initialNotes.map((note) => note.id)));
  const persisted = useRef(new Set(initialNotes.map((note) => note.id)));
  const savedSnapshots = useRef(new Map(initialNotes.map((note) => [note.id, note])));
  const queue = useRef(new Map<string, Promise<void>>());
  const closing = useRef(new Set<string>());
  const prompting = useRef(new Set<string>());
  const supabase = useRef(createClient());
  function replaceNote(note: Note) {
    notesRef.current = notesRef.current.map((item) => item.id === note.id ? note : item);
    setNotes(notesRef.current);
  }
  function removeNote(noteId: string) {
    notesRef.current = notesRef.current.filter((item) => item.id !== noteId);
    setNotes(notesRef.current);
    setNoteErrors((previous) => { const next = { ...previous }; delete next[noteId]; return next; });
  }
  function discardDraft(noteId: string) {
    setNoteErrors((previous) => { const next = { ...previous }; delete next[noteId]; return next; });
  }
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true));
    const resize = () => {
      const previous = notesRef.current;
      notesRef.current = previous.map((note) => {
        const adjusted = clamp(note);
        const snapshot = savedSnapshots.current.get(note.id);
        if (snapshot && sameStickyNoteContent(note, snapshot)) savedSnapshots.current.set(note.id, adjusted);
        return adjusted;
      });
      setNotes(notesRef.current);
    };
    window.addEventListener("resize", resize);
    const clampFrame = window.requestAnimationFrame(resize);
    return () => { window.cancelAnimationFrame(frame); window.cancelAnimationFrame(clampFrame); window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => {
    const { data: listener } = supabase.current.auth.onAuthStateChange((_event, session) => {
      setSameUser(session?.user.id === userId);
    });
    return () => listener.subscription.unsubscribe();
  }, [userId]);

  async function save(note: Note) {
    const previous = queue.current.get(note.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const payload = stickyNoteSavePayload(note, userId, titleSupported);
      const operation = persisted.current.has(note.id) ? "update" : "insert";
      const result = persisted.current.has(note.id)
        ? await supabase.current.from("user_sticky_notes").update(payload).eq("id", note.id).eq("user_id", userId).select("id").maybeSingle()
        : await supabase.current.from("user_sticky_notes").insert(payload).select("id").single();
      if (result.error || !result.data) {
        if (process.env.NODE_ENV === "development") console.error("Sticky note save failed", { operation, status: result.status, statusText: result.statusText, code: result.error?.code, message: result.error?.message, details: result.error?.details, hint: result.error?.hint, returnedRow: Boolean(result.data) });
        throw new Error("Could not save sticky note.");
      }
      persisted.current.add(note.id);
      setSavedNoteIds((previous) => new Set(previous).add(note.id));
      savedSnapshots.current.set(note.id, note);
      setNoteErrors((previous) => { const next = { ...previous }; delete next[note.id]; return next; });
      setNotes([...notesRef.current]);
    });
    queue.current.set(note.id, next);
    try { await next; } catch (cause) {
      if (process.env.NODE_ENV === "development" && !(cause instanceof Error && cause.message === "Could not save sticky note.")) console.error("Sticky note save request failed", cause);
      setNoteErrors((previous) => ({ ...previous, [note.id]: "Save failed. Your changes are still here." }));
      throw new Error("Save failed");
    }
  }
  function change(note: Note, persist = false) {
    if (closing.current.has(note.id)) return;
    replaceNote(note);
    if (persist) commit(note.id);
  }
  function commit(noteId: string) {
    if (prompting.current.has(noteId) || closing.current.has(noteId)) return;
    const note = notesRef.current.find((item) => item.id === noteId);
    if (note && persisted.current.has(noteId)) void save(note).catch(() => {});
  }
  async function saveDraft(noteId: string, draft: NoteDraft): Promise<boolean> {
    const current = notesRef.current.find((item) => item.id === noteId);
    if (!current) return false;
    try {
      const next = await persistStickyTextDraft(current, draft, save);
      replaceNote(next);
      return true;
    } catch { return false; }
  }
  function newNote() {
    const now = new Date().toISOString();
    const note: Note = clamp({ id: crypto.randomUUID(), title: "", body: "", color: "yellow", x: 28 + (notesRef.current.length % 5) * 24, y: 100 + (notesRef.current.length % 5) * 24, ...SIZE, is_open: true, created_at: now, updated_at: now });
    notesRef.current = [...notesRef.current, note]; setNotes(notesRef.current);
    setFront((previous) => [...previous, note.id]); setMenuOpen(false);
  }
  async function requestClose(noteId: string, draft: NoteDraft | null) {
    if (closing.current.has(noteId) || prompting.current.has(noteId)) return;
    prompting.current.add(noteId);
    await (queue.current.get(noteId) ?? Promise.resolve()).catch(() => {});
    const note = notesRef.current.find((item) => item.id === noteId);
    const snapshot = savedSnapshots.current.get(noteId);
    if (!note) { prompting.current.delete(noteId); return; }
    const textChanged = draft && stickyNoteTextChanged(draft, note);
    if (snapshot && !textChanged && sameStickyNoteContent(note, snapshot)) {
      void closeNote(noteId, "discard");
    } else {
      setClosingWasSaved(Boolean(snapshot));
      setClosingDraft(draft);
      setClosingId(noteId);
    }
  }
  async function closeNote(noteId: string, choice: "save" | "discard", draft: NoteDraft | null = null) {
    const current = notesRef.current.find((item) => item.id === noteId);
    if (!current || closing.current.has(noteId)) return;
    const snapshot = savedSnapshots.current.get(noteId);
    closing.current.add(noteId);
    setClosingId(null);
    if (choice === "discard" && !snapshot) {
      removeNote(noteId);
      closing.current.delete(noteId);
      prompting.current.delete(noteId);
      return;
    }
    const closed = clamp({ ...(choice === "discard" && snapshot ? snapshot : current), ...(choice === "save" && draft ? draft : {}), is_open: false });
    try {
      await save(closed);
      replaceNote(closed);
      setError("");
    } catch {
      setNoteErrors((previous) => ({ ...previous, [noteId]: "Could not close this note. Your changes are still here." }));
    } finally { closing.current.delete(noteId); prompting.current.delete(noteId); setClosingDraft(null); }
  }
  function cancelClose() {
    if (closingId) prompting.current.delete(closingId);
    setClosingId(null);
    setClosingDraft(null);
  }
  async function deleteSaved() {
    const noteId = deletingId;
    if (!noteId || saving) return;
    setSaving(true);
    try {
      await (queue.current.get(noteId) ?? Promise.resolve()).catch(() => {});
      const { error: deleteError } = await supabase.current.from("user_sticky_notes").delete().eq("id", noteId).eq("user_id", userId);
      if (deleteError) throw deleteError;
      persisted.current.delete(noteId);
      setSavedNoteIds((previous) => { const next = new Set(previous); next.delete(noteId); return next; });
      savedSnapshots.current.delete(noteId);
      removeNote(noteId);
      setDeletingId(null); setError("");
    } catch { setError("Could not delete this note. Please try again."); }
    finally { setSaving(false); }
  }
  async function reopen(note: Note) {
    const opened = clamp({ ...note, is_open: true });
    try { await save(opened); replaceNote(opened); setFront((previous) => [...previous.filter((id) => id !== note.id), note.id]); setMenuOpen(false); }
    catch { setError("Could not reopen this note."); }
  }
  if (!sameUser || pathname === "/login" || pathname === "/signup") return null;
  return <>
    <div className="relative"><button type="button" aria-label="Sticky Notes" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} className="app-nav-link flex items-center gap-1"><StickyNote className="size-4" /><span className="hidden sm:inline">Sticky Notes</span></button>
      {menuOpen && <div className="absolute right-0 top-full z-[90] mt-2 max-h-80 w-64 overflow-y-auto rounded-lg border border-[#d8b3c0] bg-[#fff9fb] p-2 shadow-lg">
        <button type="button" onClick={newNote} className="w-full rounded px-2 py-1.5 text-left text-sm font-semibold hover:bg-[#ffe5ec]">+ New note</button>
        {!titleSupported && <p className="px-2 py-1 text-[11px] text-red-700">Note titles need the pending database migration.</p>}
        <div className="my-1 border-t border-[#ebd5dd]" />
        {notes.filter((note) => note.is_open).map((note) => <button key={note.id} type="button" onClick={() => { setFront((previous) => [...previous.filter((id) => id !== note.id), note.id]); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[#ffe5ec]"><span className="size-3 shrink-0 rounded-sm border border-black/10" style={{ background: COLORS[note.color] }} /><span className="truncate">Bring forward: {noteLabel(note)}</span></button>)}
        <div className="my-1 border-t border-[#ebd5dd]" />
        {notes.filter((note) => !note.is_open).length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">No saved closed notes.</p> : notes.filter((note) => !note.is_open).map((note) => <div key={note.id} className="flex items-center gap-1 rounded hover:bg-[#ffe5ec]"><button type="button" onClick={() => reopen(note)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"><span className="size-3 shrink-0 rounded-sm border border-black/10" style={{ background: COLORS[note.color] }} /><span className="min-w-0"><span className="block truncate font-semibold">{noteLabel(note)}</span><span className="block truncate text-muted-foreground">{note.body.trim() || "Empty note"}</span></span></button><button type="button" aria-label={`Delete saved note: ${noteLabel(note)}`} onClick={() => { setDeletingId(note.id); setMenuOpen(false); }} className="rounded p-1.5 text-red-700 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-700"><Trash2 className="size-3.5" /></button></div>)}
      </div>}
    </div>
    {ready && createPortal(<div className="pointer-events-none fixed inset-0 z-30">{notes.filter((note) => note.is_open).map((note) => <FloatingNote key={note.id} note={note} top={front.indexOf(note.id)} error={noteErrors[note.id]} titleSupported={titleSupported} isSaved={savedNoteIds.has(note.id)} onFocus={() => setFront((previous) => [...previous.filter((id) => id !== note.id), note.id])} onChange={change} onCommit={commit} onSaveDraft={saveDraft} onDiscardDraft={discardDraft} onClose={(draft) => void requestClose(note.id, draft)} />)}</div>, document.body)}
    <Dialog open={Boolean(closingId)} onOpenChange={(open) => { if (!open) cancelClose(); }}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>Save changes before closing?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{closingWasSaved ? "This note has unsaved changes." : "This new note has not been saved."}</p><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={cancelClose} className="rounded px-3 py-2 text-sm">Cancel</button><button type="button" onClick={() => { if (closingId) void closeNote(closingId, "discard"); }} className="rounded px-3 py-2 text-sm text-red-700 hover:bg-red-50">Don&apos;t Save</button><button type="button" onClick={() => { if (closingId) void closeNote(closingId, "save", closingDraft); }} className="rounded bg-[#fb6f92] px-3 py-2 text-sm font-semibold text-[#241c20]">Save</button></div></DialogContent></Dialog>
    <Dialog open={Boolean(deletingId)} onOpenChange={(open) => { if (!open && !saving) setDeletingId(null); }}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>Delete sticky note?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">This permanently deletes the saved note.</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setDeletingId(null)} disabled={saving} className="rounded px-3 py-2 text-sm">Cancel</button><button type="button" onClick={deleteSaved} disabled={saving} className="rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">{saving ? "Deleting…" : "Delete"}</button></div></DialogContent></Dialog>
    {error && <div role="alert" className="fixed bottom-3 left-3 z-[100] max-w-xs rounded-md bg-[#fff2bd] px-3 py-2 text-xs text-[#241c20]">{error}</div>}
  </>;
}
