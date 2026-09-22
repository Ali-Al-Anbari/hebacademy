"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCard, deleteCard, moveCard, saveCard, setCardStar } from "./card-actions";
import { CardForm, type CardFormValues } from "./card-form";
import { removeCardImages, uploadCardImage } from "./card-images";

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
    if (busyId || !window.confirm("Delete this card? This cannot be undone.")) return;
    setBusyId(card.id);
    setMessage("");
    try {
      const result = await deleteCard(courseId, deckId, card.id);
      if (result.error) setMessage(result.error);
      else router.refresh();
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

  return (
    <section className="mt-9">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Cards</h2>
          <p className="mt-1 text-sm text-slate-500">{cards.length} {cards.length === 1 ? "card" : "cards"} in this deck</p>
        </div>
        <button type="button" onClick={() => { setAdding(!adding); setEditingId(null); setMessage(""); }} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-5 font-medium sm:w-auto ${adding ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "bg-teal-700 text-white hover:bg-teal-800"}`}>
          <span aria-hidden="true" className="text-xl leading-none">{adding ? "×" : "+"}</span>{adding ? "Close form" : "Add Card"}
        </button>
      </div>

      {adding && <div className="mt-5"><CardForm onSave={add} onCancel={() => setAdding(false)} /></div>}
      {message && <p role="alert" className="mt-4 text-sm text-red-700">{message}</p>}

      {cards.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-slate-600">No cards yet. Add your first card to this deck.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {cards.map((card, index) => (
            <article key={card.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Card {index + 1}</p>
                  <h3 className="mt-2 whitespace-pre-wrap break-words text-lg font-semibold text-slate-900">{card.prompt}</h3>
                  {card.prompt_image_url && <Image unoptimized src={card.prompt_image_url} alt="Prompt illustration" width={640} height={400} className="mt-3 max-h-56 w-auto max-w-full rounded-lg object-contain" />}
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Answer</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{card.answer}</p>
                  {card.answer_image_url && <Image unoptimized src={card.answer_image_url} alt="Answer illustration" width={640} height={400} className="mt-3 max-h-56 w-auto max-w-full rounded-lg object-contain" />}
                </div>
                <button type="button" disabled={Boolean(busyId)} onClick={() => changeStar(card)} aria-label={card.is_starred ? "Unstar card" : "Star card"} aria-pressed={card.is_starred} className="min-h-11 min-w-11 shrink-0 rounded-lg px-2 py-1 text-2xl text-amber-500 hover:bg-amber-50 disabled:opacity-50">{card.is_starred ? "★" : "☆"}</button>
              </div>
              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <button type="button" disabled={Boolean(busyId) || index === 0} onClick={() => move(card, "up")} className="min-h-11 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40">Move up</button>
                <button type="button" disabled={Boolean(busyId) || index === cards.length - 1} onClick={() => move(card, "down")} className="min-h-11 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40">Move down</button>
                <button type="button" disabled={Boolean(busyId)} onClick={() => { setAdding(false); setEditingId(card.id); setMessage(""); }} className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40">Edit</button>
                <button type="button" disabled={Boolean(busyId)} onClick={() => remove(card)} className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40">Delete</button>
              </div>
              {editingId === card.id && (
                <div className="mt-4">
                  <CardForm key={card.id} initial={{ prompt: card.prompt, answer: card.answer, hasPromptImage: Boolean(card.prompt_image_path), hasAnswerImage: Boolean(card.answer_image_path) }} onSave={(values) => edit(card, values)} onCancel={() => setEditingId(null)} />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
