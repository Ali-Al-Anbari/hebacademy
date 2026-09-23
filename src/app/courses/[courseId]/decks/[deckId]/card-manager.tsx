"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { createCard, deleteCard, moveCard, saveCard, setCardStar } from "./card-actions";
import { CardForm, type CardFormValues } from "./card-form";
import { removeCardImages, uploadCardImage } from "./card-images";
import { ImportCards } from "./import-cards";

type Card = {
  id: string;
  prompt: string;
  answer: string;
  prompt_image_path: string | null;
  answer_image_path: string | null;
  prompt_image_url: string | null;
  answer_image_url: string | null;
  is_starred: boolean;
};

export function CardManager({ courseId, deckId, userId, cards }: {
  courseId: string;
  deckId: string;
  userId: string;
  cards: Card[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<Card | null>(null);

  async function uploadSelected(cardId: string, values: CardFormValues) {
    const uploaded: string[] = [];
    try {
      const promptPath = values.promptFile
        ? await uploadCardImage(values.promptFile, userId, deckId, cardId)
        : null;
      if (promptPath) uploaded.push(promptPath);
      const answerPath = values.answerFile
        ? await uploadCardImage(values.answerFile, userId, deckId, cardId)
        : null;
      if (answerPath) uploaded.push(answerPath);
      return { promptPath, answerPath, uploaded };
    } catch {
      await removeCardImages(uploaded);
      throw new Error("Image upload failed. Use JPEG, PNG, WebP, or GIF under 5 MB.");
    }
  }

  async function add(values: CardFormValues): Promise<string | null> {
    const result = await createCard(courseId, deckId, values.prompt, values.answer);
    if (result.error || !result.id) return result.error ?? "Could not add the card.";
    try {
      const images = await uploadSelected(result.id, values);
      if (images.uploaded.length) {
        const saved = await saveCard(courseId, deckId, result.id, values.prompt, values.answer, images.promptPath, images.answerPath);
        if (saved.error) {
          await removeCardImages(images.uploaded);
          throw new Error("Images could not be attached.");
        }
      }
      setAdding(false);
      router.refresh();
      return null;
    } catch {
      setAdding(false);
      setMessage("Card created, but its images could not be saved. Edit the card to retry.");
      router.refresh();
      return null;
    }
  }

  async function edit(card: Card, values: CardFormValues): Promise<string | null> {
    let images: Awaited<ReturnType<typeof uploadSelected>>;
    try {
      images = await uploadSelected(card.id, values);
    } catch {
      return "Image upload failed. Use JPEG, PNG, WebP, or GIF under 5 MB.";
    }
    const promptPath = images.promptPath ?? (values.removePromptImage ? null : card.prompt_image_path);
    const answerPath = images.answerPath ?? (values.removeAnswerImage ? null : card.answer_image_path);
    try {
      const result = await saveCard(courseId, deckId, card.id, values.prompt, values.answer, promptPath, answerPath);
      if (result.error) {
        await removeCardImages(images.uploaded);
        return result.error;
      }
      setEditingId(null);
      router.refresh();
      return null;
    } catch {
      await removeCardImages(images.uploaded);
      return "Could not save the card. Please try again.";
    }
  }

  async function remove(card: Card) {
    if (busyId) return;
    setBusyId(card.id);
    setMessage("");
    try {
      const result = await deleteCard(courseId, deckId, card.id);
      if (result.error) setMessage(result.error);
      else { setDeleting(null); router.refresh(); }
    } catch {
      setMessage("Could not delete the card. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function changeStar(card: Card) {
    if (busyId) return;
    setBusyId(card.id);
    setMessage("");
    try {
      const result = await setCardStar(courseId, deckId, card.id, !card.is_starred);
      if (result.error) setMessage(result.error);
      else router.refresh();
    } catch {
      setMessage("Could not update the card. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function move(card: Card, direction: "up" | "down") {
    if (busyId) return;
    setBusyId(card.id);
    setMessage("");
    try {
      const result = await moveCard(courseId, deckId, card.id, direction);
      if (result.error) setMessage(result.error);
      else router.refresh();
    } catch {
      setMessage("Could not move the card. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return <section className="mt-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="section-title">Cards</h2><p className="section-meta">{cards.length} {cards.length === 1 ? "card" : "cards"} in this deck</p></div><div className="flex flex-col gap-2 sm:flex-row"><ImportCards courseId={courseId} deckId={deckId} /><Button type="button" className="w-full sm:w-auto" onClick={() => { setAdding(true); setEditingId(null); setMessage(""); }}><Plus /> Add Card</Button></div></div>
    {message && <p role="alert" className="notice-error mt-4 text-sm">{message}</p>}
    {adding && <div className="mt-5 rounded-lg border border-border bg-white p-5 sm:p-6"><h3 className="mb-5 text-base font-semibold">Create card</h3><CardForm key="new" onSave={add} onCancel={() => setAdding(false)} /></div>}
    {cards.length === 0 ? (!adding && <div className="empty-panel mt-5"><h3 className="empty-panel__title">Build your first flashcard</h3><p className="empty-panel__copy">Add a prompt and answer to make this deck ready to study.</p></div>) :
      <div className="mt-5 grid gap-3">{cards.map((card, index) => (
        <Card key={card.id} className="min-w-0 py-0">
          <CardContent className="flex items-start gap-3 p-4 sm:gap-5 sm:p-5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Card {index + 1}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><h3 className="whitespace-pre-wrap break-words text-base font-semibold leading-snug">{card.prompt}</h3>{card.is_starred && <Badge variant="secondary" className="text-[#8b6829]"><Star className="size-3 fill-current" /> Starred</Badge>}</div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{card.answer}</p>
              {(card.prompt_image_url || card.answer_image_url) && <div className="mt-3 flex gap-2">{card.prompt_image_url && <Image unoptimized src={card.prompt_image_url} alt="Prompt illustration" width={64} height={64} className="size-16 rounded-md bg-muted object-cover" />}{card.answer_image_url && <Image unoptimized src={card.answer_image_url} alt="Answer illustration" width={64} height={64} className="size-16 rounded-md bg-muted object-cover" />}</div>}
              {(card.prompt_image_path || card.answer_image_path) && <div className="mt-3 flex flex-wrap gap-2">{card.prompt_image_path && <Badge variant="outline" className="text-muted-foreground"><ImageIcon /> Prompt image</Badge>}{card.answer_image_path && <Badge variant="outline" className="text-muted-foreground"><ImageIcon /> Answer image</Badge>}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1"><Button type="button" variant="ghost" size="icon" disabled={Boolean(busyId)} onClick={() => changeStar(card)} aria-label={card.is_starred ? "Unstar card" : "Star card"} aria-pressed={card.is_starred} className={card.is_starred ? "text-[#8b6829]" : "text-muted-foreground"}><Star className={card.is_starred ? "fill-current" : ""} /></Button><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" disabled={Boolean(busyId)} aria-label={`Manage card ${index + 1}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-44"><DropdownMenuItem onClick={() => { setAdding(false); setEditingId(card.id); setMessage(""); }}><Pencil /> Edit card</DropdownMenuItem><DropdownMenuItem disabled={index === 0} onClick={() => move(card, "up")}><ArrowUp /> Move up</DropdownMenuItem><DropdownMenuItem disabled={index === cards.length - 1} onClick={() => move(card, "down")}><ArrowDown /> Move down</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setDeleting(card)}><Trash2 /> Delete card</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
          </CardContent>
          {editingId === card.id && <div className="border-t border-border p-5 sm:p-6"><h4 className="mb-5 text-base font-semibold">Edit card</h4><CardForm key={card.id} initial={{ prompt: card.prompt, answer: card.answer, hasPromptImage: Boolean(card.prompt_image_path), hasAnswerImage: Boolean(card.answer_image_path) }} onSave={(values) => edit(card, values)} onCancel={() => setEditingId(null)} /></div>}
        </Card>
      ))}</div>}
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busyId) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this card?</AlertDialogTitle><AlertDialogDescription>The prompt, answer, and images will be removed. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>{message && <p role="alert" className="notice-error text-sm">{message}</p>}<AlertDialogFooter><AlertDialogCancel disabled={Boolean(busyId)}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={Boolean(busyId)} onClick={() => { if (deleting) void remove(deleting); }}>{busyId ? "Deleting…" : "Delete card"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
