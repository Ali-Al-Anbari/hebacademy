"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCalendarDate, isCalendarDate, type ScheduleSelectionMode } from "@/lib/schedules";
import { createSchedule, loadScheduleDeckCards } from "../actions";

type Course = { id: string; name: string };
type Deck = { id: string; name: string; course_id: string };
type Card = { id: string; prompt: string; answer: string; is_starred: boolean };

const selectClass = "h-11 w-full rounded-lg border border-input bg-white px-3.5 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50 md:text-sm";

export function ScheduleForm({ courses, decks }: { courses: Course[]; decks: Deck[] }) {
  const router = useRouter();
  const requestNumber = useRef(0);
  const submitting = useRef(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [courseId, setCourseId] = useState("");
  const [deckId, setDeckId] = useState("");
  const [examDate, setExamDate] = useState("");
  const [mode, setMode] = useState<ScheduleSelectionMode>("all");
  const [cards, setCards] = useState<Card[]>([]);
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [reviewDate, setReviewDate] = useState("");
  const [reviewDates, setReviewDates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [partialId, setPartialId] = useState<string | null>(null);

  const availableDecks = decks.filter((deck) => deck.course_id === courseId);
  const selectedCount = mode === "all" ? cards.length
    : mode === "starred" ? cards.filter((card) => card.is_starred).length
      : manualIds.length;
  const datesPastExam = Boolean(examDate && isCalendarDate(examDate)
    && reviewDates.some((date) => date > examDate));

  function chooseCourse(id: string) {
    requestNumber.current += 1;
    setCourseId(id);
    setDeckId("");
    setCards([]);
    setManualIds([]);
    setCardsLoaded(false);
    setLoadingCards(false);
    setMessage("");
  }

  async function chooseDeck(id: string) {
    const request = ++requestNumber.current;
    setDeckId(id);
    setCards([]);
    setManualIds([]);
    setCardsLoaded(false);
    setMessage("");
    if (!id) return;
    setLoadingCards(true);
    try {
      const result = await loadScheduleDeckCards(courseId, id);
      if (request !== requestNumber.current) return;
      if (result.error) setMessage(result.error);
      else {
        setCards(result.cards);
        setCardsLoaded(true);
      }
    } catch {
      if (request === requestNumber.current) setMessage("Could not load this deck's cards. Try again.");
    } finally {
      if (request === requestNumber.current) setLoadingCards(false);
    }
  }

  function addDate() {
    if (!isCalendarDate(reviewDate)) {
      setMessage("Choose a valid review date.");
      return;
    }
    if (reviewDates.includes(reviewDate)) {
      setMessage("That review date is already selected.");
      return;
    }
    setReviewDates((dates) => [...dates, reviewDate].sort());
    setReviewDate("");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitting.current) return;
    setMessage("");
    setPartialId(null);
    if (!name.trim() || name.trim().length > 120) {
      setMessage("Enter a schedule name of 1 to 120 characters.");
      return;
    }
    if (!courseId || !deckId || !cardsLoaded) {
      setMessage("Choose a deck and wait for its cards to load.");
      return;
    }
    if (examDate && !isCalendarDate(examDate)) {
      setMessage("Choose a valid exam date or leave it blank.");
      return;
    }
    if (reviewDate) {
      setMessage("Add the pending review date, or clear it before saving.");
      return;
    }
    if (new Set(reviewDates).size !== reviewDates.length) {
      setMessage("Remove duplicate review dates.");
      return;
    }

    submitting.current = true;
    setBusy(true);
    let saved = false;
    try {
      const result = await createSchedule({
        name, description, courseId, deckId, examDate,
        selectionMode: mode, manualCardIds: manualIds, reviewDates,
      });
      if (result.error) {
        setMessage(result.error);
        setPartialId(result.scheduleId);
      } else if (result.scheduleId) {
        saved = true;
        router.push(`/study-schedules/${result.scheduleId}`);
      }
    } catch {
      setMessage("Could not save the schedule. Please refresh the dashboard before retrying to check whether it was created.");
    } finally {
      if (!saved) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <form onSubmit={save} className="surface-panel mt-6 space-y-7">
      <section className="space-y-4" aria-labelledby="schedule-details-title">
        <h2 id="schedule-details-title" className="section-title">Schedule details</h2>
        <div className="space-y-2"><Label htmlFor="schedule-name">Schedule name</Label><Input id="schedule-name" required maxLength={120} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ocular Anatomy — Exam 1" /></div>
        <div className="space-y-2"><Label htmlFor="schedule-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="schedule-description" maxLength={1000} rows={3} disabled={busy} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="schedule-course">Course</Label><select id="schedule-course" required disabled={busy} className={selectClass} value={courseId} onChange={(event) => chooseCourse(event.target.value)}><option value="">Choose a course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="schedule-deck">Deck</Label><select id="schedule-deck" required disabled={!courseId || busy || loadingCards} className={selectClass} value={deckId} onChange={(event) => void chooseDeck(event.target.value)}><option value="">Choose a deck</option>{availableDecks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></div>
        </div>
        {courseId && availableDecks.length === 0 && <p className="field-hint">This course has no decks yet. Add a deck before creating a schedule.</p>}
        <div className="space-y-2"><Label htmlFor="schedule-exam-date">Exam date <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="schedule-exam-date" type="date" disabled={busy} value={examDate} onChange={(event) => setExamDate(event.target.value)} /></div>
      </section>

      <section className="space-y-4 border-t border-border pt-6" aria-labelledby="schedule-cards-title">
        <div><h2 id="schedule-cards-title" className="section-title">Choose cards</h2><p className="page-description mt-1">Your selection is saved now. Later changes to stars or ratings will not change it.</p></div>
        {loadingCards && <p role="status" className="text-sm text-muted-foreground">Loading deck cards…</p>}
        {deckId && !loadingCards && !cardsLoaded && <Button type="button" variant="secondary" disabled={busy} onClick={() => void chooseDeck(deckId)}>Retry loading cards</Button>}
        <fieldset disabled={!cardsLoaded || busy} className="space-y-2">
          <legend className="sr-only">Card selection method</legend>
          {([ ["all", "Entire deck", "All current cards"], ["starred", "Starred cards", "Only cards starred now"], ["manual", "Manual selection", "Pick cards individually"] ] as const).map(([value, title, description]) => (
            <label key={value} className="mode-option flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <input type="radio" name="card-selection" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-primary" />
              <span><span className="block font-medium text-foreground">{title}</span><span className="block text-sm text-muted-foreground">{description}</span></span>
            </label>
          ))}
        </fieldset>
        {cardsLoaded && mode === "manual" && (
          cards.length ? <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-2" aria-label="Choose individual cards">{cards.map((card) => (
            <label key={card.id} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/60">
              <input type="checkbox" disabled={busy} checked={manualIds.includes(card.id)} onChange={(event) => setManualIds((ids) => event.target.checked ? [...ids, card.id] : ids.filter((id) => id !== card.id))} className="mt-1 accent-primary" />
              <span className="min-w-0"><span className="block break-words font-medium text-foreground">{card.prompt}</span><span className="mt-1 block line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{card.answer}</span></span>
            </label>
          ))}</div> : <p className="field-hint">This deck has no cards yet.</p>
        )}
        {cardsLoaded && <p aria-live="polite" className="text-sm font-medium text-foreground">{selectedCount} {selectedCount === 1 ? "card" : "cards"} selected{selectedCount === 0 ? " — you can save the schedule and add cards later." : ""}</p>}
      </section>

      <section className="space-y-4 border-t border-border pt-6" aria-labelledby="schedule-dates-title">
        <div><h2 id="schedule-dates-title" className="section-title">Review dates</h2><p className="page-description mt-1">Pick your own days. Dates and exam date are optional.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><div className="flex-1 space-y-2"><Label htmlFor="review-date">Add a review date</Label><Input id="review-date" type="date" disabled={busy} value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /></div><Button type="button" variant="secondary" disabled={busy} onClick={addDate} className="w-full sm:w-auto">Add date</Button></div>
        {reviewDates.length > 0 && <ul className="space-y-2">{reviewDates.map((date) => <li key={date} className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2"><span className="text-sm text-foreground">{formatCalendarDate(date)}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => setReviewDates((dates) => dates.filter((item) => item !== date))} aria-label={`Remove ${formatCalendarDate(date)}`}>Remove</Button></li>)}</ul>}
        {datesPastExam && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Some review dates are after the exam date. You can still save this schedule.</p>}
      </section>

      {message && <p role="alert" className="notice-error text-sm">{message}{partialId && <> <Link href={`/study-schedules/${partialId}`} className="font-semibold underline">View the partial schedule</Link>.</>}</p>}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end"><Link href="/" className={buttonVariants({ variant: "secondary", className: "w-full sm:w-auto" })}>Cancel</Link><Button type="submit" disabled={busy || loadingCards || !cardsLoaded} className="w-full sm:w-auto">{busy ? "Saving…" : "Create schedule"}</Button></div>
    </form>
  );
}
