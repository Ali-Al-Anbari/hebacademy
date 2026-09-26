"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, ImageIcon, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

function DeckCardAnswer({
  answer,
  imageUrl,
  hasImagePath,
}: {
  answer: string;
  imageUrl: string | null;
  hasImagePath: boolean;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={revealed ? "Hide answer" : "Reveal answer"}
      onClick={() => setRevealed((prev) => !prev)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed((prev) => !prev);
        }
      }}
      className="group relative mt-3 block cursor-pointer rounded-lg p-2.5 -ml-2.5 transition-colors hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink/70"
    >
      <div
        className={`transition-all duration-200 ${
          revealed
            ? "blur-none select-auto opacity-100"
            : "blur-[6px] select-none opacity-60 group-hover:blur-none group-hover:select-auto group-hover:opacity-100 group-focus-within:blur-none group-focus-within:select-auto group-focus-within:opacity-100"
        }`}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
          {answer}
        </p>
        {imageUrl && (
          <div className="mt-3">
            <Image
              unoptimized
              src={imageUrl}
              alt="Answer illustration"
              width={64}
              height={64}
              className="size-16 rounded-md bg-muted object-cover"
            />
          </div>
        )}
        {hasImagePath && !imageUrl && (
          <div className="mt-3">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ImageIcon className="size-3" /> Answer image
            </span>
          </div>
        )}
      </div>

      {!revealed && (
        <span className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-ink/75 bg-white/90 backdrop-blur-xs py-1 px-2.5 rounded-full border border-border/80 shadow-2xs w-fit mx-auto opacity-90 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
          <Eye className="size-3.5 text-muted-foreground" />
          <span>Reveal answer</span>
        </span>
      )}
    </div>
  );
}

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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="section-title">Cards</h2><p className="section-meta">{cards.length} {cards.length === 1 ? "card" : "cards"} in this deck</p></div><div className="flex flex-col gap-2 sm:flex-row"><ImportCards courseId={courseId} deckId={deckId} /><Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => { setAdding(true); setEditingId(null); setMessage(""); }}>Add Card</Button></div></div>
    {message && <p role="alert" className="notice-error mt-4 text-sm">{message}</p>}
    {adding && <div className="surface-panel mt-5"><h3 className="mb-5 text-base font-semibold">Create card</h3><CardForm key="new" onSave={add} onCancel={() => setAdding(false)} /></div>}
    {cards.length === 0 ? (!adding && <div className="deck-card-row mt-5 border-b py-7"><h3 className="text-lg font-semibold">No cards yet</h3><p className="mt-1 text-sm text-muted-foreground">Add a prompt and answer to make this deck ready to study.</p><Button type="button" variant="secondary" className="mt-4" onClick={() => { setAdding(true); setEditingId(null); setMessage(""); }}>Add Card</Button></div>) :
      <div className="mt-5">{cards.map((card, index) => (
        <article key={card.id} className="deck-card-row min-w-0">
          <div className="flex items-start gap-3 px-1 py-4 sm:gap-5 sm:px-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Card {index + 1}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><h3 className="whitespace-pre-wrap break-words text-base font-semibold leading-snug">{card.prompt}</h3>{card.is_starred && <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink"><Star className="size-3 fill-current" /> Starred</span>}</div>
              {card.prompt_image_url && (
                <div className="mt-3">
                  <Image unoptimized src={card.prompt_image_url} alt="Prompt illustration" width={64} height={64} className="size-16 rounded-md bg-muted object-cover" />
                </div>
              )}
              {card.prompt_image_path && !card.prompt_image_url && (
                <div className="mt-3">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ImageIcon className="size-3" /> Prompt image</span>
                </div>
              )}
              <DeckCardAnswer
                answer={card.answer}
                imageUrl={card.answer_image_url}
                hasImagePath={Boolean(card.answer_image_path)}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1"><Button type="button" variant="ghost" size="icon" disabled={Boolean(busyId)} onClick={() => changeStar(card)} aria-label={card.is_starred ? "Unstar card" : "Star card"} aria-pressed={card.is_starred} className={card.is_starred ? "text-brand-ink" : "text-muted-foreground"}><Star className={card.is_starred ? "fill-current" : ""} /></Button><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" disabled={Boolean(busyId)} aria-label={`Manage card ${index + 1}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-44"><DropdownMenuItem onClick={() => { setAdding(false); setEditingId(card.id); setMessage(""); }}><Pencil /> Edit card</DropdownMenuItem><DropdownMenuItem disabled={index === 0} onClick={() => move(card, "up")}><ArrowUp /> Move up</DropdownMenuItem><DropdownMenuItem disabled={index === cards.length - 1} onClick={() => move(card, "down")}><ArrowDown /> Move down</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setDeleting(card)}><Trash2 /> Delete card</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
          </div>
          {editingId === card.id && <div className="border-t border-border bg-white/70 p-5 sm:p-6"><h4 className="mb-5 text-base font-semibold">Edit card</h4><CardForm key={card.id} initial={{ prompt: card.prompt, answer: card.answer, hasPromptImage: Boolean(card.prompt_image_path), hasAnswerImage: Boolean(card.answer_image_path) }} onSave={(values) => edit(card, values)} onCancel={() => setEditingId(null)} /></div>}
        </article>
      ))}</div>}
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !busyId) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this card?</AlertDialogTitle><AlertDialogDescription>The prompt, answer, and images will be removed. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>{message && <p role="alert" className="notice-error text-sm">{message}</p>}<AlertDialogFooter><AlertDialogCancel disabled={Boolean(busyId)}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={Boolean(busyId)} onClick={() => { if (deleting) void remove(deleting); }}>{busyId ? "Deleting…" : "Delete card"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
