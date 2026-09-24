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
import { Textarea } from "@/components/ui/textarea";
import { createDeck, deleteDeck, updateDeck } from "./deck-actions";

type Deck = { id: string; name: string; description: string | null };

export function DeckManager({ courseId, courseName, decks }: { courseId: string; courseName: string; decks: Deck[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<Deck | null>(null);

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
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteDeck(courseId, deck.id);
      if (result.error) setMessage(result.error);
      else { setDeleting(null); router.refresh(); }
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

  const editing = Boolean(editingId);
  return <>
    <div className="page-intro mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="page-title">{courseName}</h1><p className="page-description">{decks.length} {decks.length === 1 ? "deck" : "decks"}</p></div><Button type="button" className="w-full sm:w-auto" onClick={() => { setEditingId(null); setName(""); setDescription(""); setMessage(""); setAdding(true); }}><Plus /> Add Deck</Button></div>
    {message && !adding && !editing && <p role="alert" className="notice-error mt-4 text-sm">{message}</p>}
    {decks.length === 0 ? <div className="empty-panel mt-5"><h3 className="empty-panel__title">No decks yet</h3><p className="empty-panel__copy">Add a deck to start collecting cards for this course.</p><Button type="button" className="mt-5" onClick={() => { setEditingId(null); setName(""); setDescription(""); setMessage(""); setAdding(true); }}><Plus /> Add Deck</Button></div> :
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{decks.map((deck) => <Card key={deck.id} className="resource-card min-w-0 py-0"><CardContent className="flex min-h-32 items-start gap-2 p-5"><Link href={`/courses/${courseId}/decks/${deck.id}`} className="min-w-0 flex-1 self-stretch rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><h2 className="break-words text-base font-semibold text-foreground group-hover/card:text-brand-ink">{deck.name}</h2>{deck.description && <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{deck.description}</p>}</Link><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Manage ${deck.name}`} className="-mr-2 -mt-2 text-muted-foreground" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-40"><DropdownMenuItem onClick={() => startEditing(deck)}><Pencil /> Edit deck</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setDeleting(deck)}><Trash2 /> Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></CardContent></Card>)}</div>}
    <Dialog open={adding || editing} onOpenChange={(open) => { if (!open && !busy) { setAdding(false); setEditingId(null); } }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="text-xl font-semibold">{editing ? "Edit deck" : "Create a deck"}</DialogTitle><DialogDescription>{editing ? "Update this deck’s name or description." : "Give a topic a home for its cards."}</DialogDescription></DialogHeader><form onSubmit={editing ? save : add} className="space-y-5"><div className="space-y-2"><Label htmlFor="deck-name">Deck name</Label><Input id="deck-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required autoFocus placeholder="e.g. Ocular Anatomy" /></div><div className="space-y-2"><Label htmlFor="deck-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="deck-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} placeholder="What will you study in this deck?" /></div>{message && <p role="alert" className="notice-error text-sm">{message}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => { setAdding(false); setEditingId(null); }}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create deck"}</Button></div></form></DialogContent></Dialog>
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this deck?</AlertDialogTitle><AlertDialogDescription>“{deleting?.name}” and its cards will be deleted. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>{message && <p role="alert" className="notice-error text-sm">{message}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => { if (deleting) void remove(deleting); }}>{busy ? "Deleting…" : "Delete deck"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
