"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { finishStudy, rateCard } from "./actions";

type Rating = "review_again" | "needs_practice" | "mastered";
type Counts = Record<Rating, number>;
type StudyCard = {
  id: string;
  prompt: string;
  answer: string;
  promptImageUrl: string | null;
  answerImageUrl: string | null;
};

export function StudyView({ courseId, deckId, sessionId, cards, reviews, completed }: {
  courseId: string;
  deckId: string;
  sessionId: string;
  cards: StudyCard[];
  reviews: { card_id: string; rating: string }[];
  completed: boolean;
}) {
  const router = useRouter();
  const [reviewed, setReviewed] = useState(() => new Set(reviews.map((review) => review.card_id)));
  const [index, setIndex] = useState(() => cards.findIndex((card) => !reviews.some((review) => review.card_id === card.id)));
  const [counts, setCounts] = useState<Counts>(() => ({
    review_again: reviews.filter((review) => review.rating === "review_again").length,
    needs_practice: reviews.filter((review) => review.rating === "needs_practice").length,
    mastered: reviews.filter((review) => review.rating === "mastered").length,
  }));
  const [isComplete, setIsComplete] = useState(completed);
  const [typed, setTyped] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function rate(rating: Rating) {
    const card = cards[index];
    if (!revealed || !card || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await rateCard(courseId, deckId, sessionId, card.id, rating);
      if (result.error || !result.state) {
        setMessage(result.error ?? "Could not save this rating. Please try again.");
        return;
      }
      const nextReviewed = new Set(reviewed);
      nextReviewed.add(card.id);
      setReviewed(nextReviewed);
      setCounts(result.state.counts);
      if (result.state.complete) {
        setIsComplete(true);
      } else {
        setIndex(cards.findIndex((candidate) => !nextReviewed.has(candidate.id)));
        setTyped("");
        setRevealed(false);
      }
    } catch {
      setMessage("Could not save this rating. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await finishStudy(courseId, deckId, sessionId);
      if (result.error || !result.state) setMessage(result.error ?? "Could not complete this session.");
      else {
        setCounts(result.state.counts);
        setIsComplete(true);
      }
    } catch {
      setMessage("Could not complete this session. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const deckUrl = `/courses/${courseId}/decks/${deckId}`;
  if (isComplete) {
    return (
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-teal-700">Study complete</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">You finished this deck</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-rose-50 p-4"><p className="text-sm text-rose-800">Review Again</p><p className="mt-1 text-2xl font-semibold text-rose-900">{counts.review_again}</p></div>
          <div className="rounded-lg bg-amber-50 p-4"><p className="text-sm text-amber-800">Needs Practice</p><p className="mt-1 text-2xl font-semibold text-amber-900">{counts.needs_practice}</p></div>
          <div className="rounded-lg bg-teal-50 p-4"><p className="text-sm text-teal-800">Mastered</p><p className="mt-1 text-2xl font-semibold text-teal-900">{counts.mastered}</p></div>
        </div>
        <Link href={deckUrl} className="mt-7 inline-flex rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800">Back to Deck</Link>
      </section>
    );
  }

  if (index < 0) {
    return (
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold text-slate-900">All loaded cards have ratings</h2>
        <p className="mt-2 text-slate-600">Finish the session, or refresh if this deck changed while you were studying.</p>
        {message && <p role="alert" className="mt-4 text-sm text-red-700">{message}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={finish} className="rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800 disabled:opacity-60">Finish Session</button>
          <button type="button" onClick={() => router.refresh()} className="rounded-lg border border-slate-300 px-5 py-2.5 text-slate-700 hover:bg-slate-50">Refresh Cards</button>
        </div>
      </section>
    );
  }

  const card = cards[index];
  return (
    <section className="mt-8">
      <p className="text-sm font-medium text-teal-700">Card {index + 1} of {cards.length}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        <div className="h-full rounded-full bg-teal-700" style={{ width: `${Math.round((reviewed.size / cards.length) * 100)}%` }} />
      </div>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Prompt</p>
        <h2 className="mt-3 whitespace-pre-wrap break-words text-xl font-semibold text-slate-900 sm:text-2xl">{card.prompt}</h2>
        {card.promptImageUrl && <Image unoptimized src={card.promptImageUrl} alt="Prompt illustration" width={640} height={400} className="mt-5 max-h-72 w-auto max-w-full rounded-lg object-contain" />}

        <label htmlFor="typed-response" className="mt-8 block text-sm font-medium text-slate-700">Your answer (optional)</label>
        <textarea id="typed-response" value={typed} onChange={(event) => setTyped(event.target.value)} readOnly={revealed} rows={4} placeholder="Think it through before revealing…" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 leading-relaxed focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20 read-only:bg-slate-50" />
        <p className="mt-1 text-xs text-slate-500">This response stays on this screen and is not graded or saved.</p>

        {!revealed ? (
          <button type="button" onClick={() => setRevealed(true)} className="mt-6 min-h-12 w-full rounded-lg bg-teal-700 px-5 py-2.5 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:w-auto">Reveal Answer</button>
        ) : (
          <>
            <div className="mt-7 border-t border-slate-200 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Correct answer</p>
              <p className="mt-3 whitespace-pre-wrap break-words text-lg text-slate-900">{card.answer}</p>
              {card.answerImageUrl && <Image unoptimized src={card.answerImageUrl} alt="Answer illustration" width={640} height={400} className="mt-5 max-h-72 w-auto max-w-full rounded-lg object-contain" />}
            </div>
            <p className="mt-7 text-sm font-medium text-slate-700">How well did you know it?</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <button type="button" disabled={busy} onClick={() => rate("review_again")} className="min-h-12 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 font-semibold text-rose-900 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60">{busy ? "Saving…" : "Review Again"}</button>
              <button type="button" disabled={busy} onClick={() => rate("needs_practice")} className="min-h-12 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60">{busy ? "Saving…" : "Needs Practice"}</button>
              <button type="button" disabled={busy} onClick={() => rate("mastered")} className="min-h-12 rounded-lg border border-teal-300 bg-teal-50 px-4 py-3 font-semibold text-teal-900 hover:bg-teal-100 disabled:cursor-wait disabled:opacity-60">{busy ? "Saving…" : "Mastered"}</button>
            </div>
          </>
        )}
        {message && <p role="alert" className="mt-4 text-sm text-red-700">{message}</p>}
      </div>
    </section>
  );
}
