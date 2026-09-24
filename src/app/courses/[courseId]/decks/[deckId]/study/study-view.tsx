"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export function StudyView({ courseId, deckId, sessionId, cards, reviews, completed, returnScheduleId }: {
  courseId: string;
  deckId: string;
  sessionId: string;
  cards: StudyCard[];
  reviews: { card_id: string; rating: string }[];
  completed: boolean;
  returnScheduleId: string | null;
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
  const exitUrl = returnScheduleId ? `/study-schedules/${returnScheduleId}` : deckUrl;
  const exit = busy
    ? <span aria-disabled="true" className={buttonVariants({ variant: "secondary", className: "opacity-50" })}>Saving…</span>
    : <Link href={exitUrl} className={buttonVariants({ variant: "secondary" })}>Exit</Link>;
  if (isComplete) {
    return (
      <section className="study-surface mt-5">
        <p className="page-eyebrow">Study complete</p>
        <h2 className="section-title mt-3">You finished this deck</h2>
        <dl className="mt-6 flex flex-wrap gap-x-9 gap-y-4 border-y border-border py-5">
          <div><dt className="text-sm text-muted-foreground">Review Again</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-clay">{counts.review_again}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Needs Practice</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-gold">{counts.needs_practice}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Mastered</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-[#347a52]">{counts.mastered}</dd></div>
        </dl>
        <div className="mt-7">{exit}</div>
      </section>
    );
  }

  if (index < 0) {
    return (
      <section className="study-surface mt-5">
        <div className="mb-5">{exit}</div>
        <h2 className="section-title">All loaded cards have ratings</h2>
        <p className="page-description mt-2">Finish the session, or refresh if this deck changed while you were studying.</p>
        {message && <p role="alert" className="notice-error mt-4 text-sm">{message}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="button" disabled={busy} onClick={finish} className="w-full sm:w-auto">Finish Session</Button>
          <Button type="button" variant="secondary" onClick={() => router.refresh()} className="w-full sm:w-auto">Refresh Cards</Button>
        </div>
      </section>
    );
  }

  const card = cards[index];
  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="page-eyebrow">Flashcard study</p><div className="flex items-center gap-3"><p className="text-sm font-medium tabular-nums text-muted-foreground">Card {index + 1} of {cards.length}</p>{exit}</div></div>
      <div className="study-progress mt-3" aria-hidden="true">
        <div style={{ width: `${Math.round((reviewed.size / cards.length) * 100)}%` }} />
      </div>
      <div className="study-surface mt-5 flex min-h-72 flex-col justify-center">
        <p className="page-eyebrow">Prompt</p>
        <h2 className="study-prompt mt-4 whitespace-pre-wrap">{card.prompt}</h2>
        {card.promptImageUrl && <Image unoptimized src={card.promptImageUrl} alt="Prompt illustration" width={640} height={400} className="mt-5 max-h-72 w-auto max-w-full rounded-md object-contain" />}
        {revealed && <div className="mt-7 border-t border-brand-100 pt-6"><p className="page-eyebrow">Answer</p><p className="mt-3 whitespace-pre-wrap break-words text-lg leading-relaxed text-ink">{card.answer}</p>{card.answerImageUrl && <Image unoptimized src={card.answerImageUrl} alt="Answer illustration" width={640} height={400} className="mt-5 max-h-72 w-auto max-w-full rounded-md object-contain" />}</div>}
      </div>
      <div className="mt-6">
        <Label htmlFor="typed-response">Your answer <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea id="typed-response" value={typed} onChange={(event) => setTyped(event.target.value)} readOnly={revealed} rows={3} placeholder="Think it through before revealing…" className="mt-2 read-only:bg-muted" />
        <p className="field-hint mt-2">This response stays on this screen and is not graded or saved.</p>
        {!revealed ? <Button type="button" size="lg" onClick={() => setRevealed(true)} className="mt-5 w-full sm:w-auto">Reveal Answer</Button> : <><p className="mt-6 text-sm font-semibold text-ink">How well did you know it?</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><button type="button" disabled={busy} onClick={() => rate("review_again")} className="rating-choice rating-choice--again">{busy ? "Saving…" : "Review Again"}</button><button type="button" disabled={busy} onClick={() => rate("needs_practice")} className="rating-choice rating-choice--practice">{busy ? "Saving…" : "Needs Practice"}</button><button type="button" disabled={busy} onClick={() => rate("mastered")} className="rating-choice rating-choice--mastered">{busy ? "Saving…" : "Mastered"}</button></div></>}
        {message && <p role="alert" className="notice-error mt-4 text-sm">{message}</p>}
      </div>
    </section>
  );
}
