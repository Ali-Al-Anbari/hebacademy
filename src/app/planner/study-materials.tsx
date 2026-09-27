"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  PlannerAssignment,
  PlannerAssignmentDeck,
  PlannerAssignmentStudySchedule,
  PlannerCourse,
  PlannerDeck,
  PlannerStudySchedule,
} from "@/lib/planner/types";
import { saveAssignmentDeckLinks, unlinkAssignmentStudySchedule } from "./study-materials-actions";

type Scope = "this" | "future" | "series";

export function StudyMaterials({
  assignment, rootId, occurrenceDate, isVirtual, isOccurrence, plannerCourse,
  courses, decks, deckLinks, schedules, scheduleLinks, onSaved,
  scheduleProgress,
}: {
  assignment: PlannerAssignment;
  rootId: string;
  occurrenceDate: string;
  isVirtual: boolean;
  isOccurrence: boolean;
  plannerCourse: PlannerCourse | undefined;
  courses: { id: string; name: string }[];
  decks: PlannerDeck[];
  deckLinks: PlannerAssignmentDeck[];
  schedules: PlannerStudySchedule[];
  scheduleLinks: PlannerAssignmentStudySchedule[];
  scheduleProgress: Record<string, { completed: number; total: number }>;
  onSaved: () => void;
}) {
  const pending = useRef(false);
  const [scope, setScope] = useState<Scope>(isOccurrence ? "this" : "series");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const sourceId = scope === "series" || isVirtual ? rootId : assignment.id;
  const activeDeckIds = deckLinks.filter((item) => item.assignment_id === sourceId).map((item) => item.deck_id);
  const activeDecks = activeDeckIds.map((id) => decks.find((deck) => deck.id === id)).filter((deck): deck is PlannerDeck => Boolean(deck));
  const activeSchedules = scheduleLinks.filter((item) => item.assignment_id === sourceId)
    .map((item) => schedules.find((schedule) => schedule.id === item.study_schedule_id))
    .filter((schedule): schedule is PlannerStudySchedule => Boolean(schedule));
  const courseNames = useMemo(() => new Map(courses.map((course) => [course.id, course.name])), [courses]);
  const suggestedCourseId = plannerCourse?.hebacademy_course_id;
  const availableDecks = decks.filter((deck) => !activeDeckIds.includes(deck.id)
    && `${deck.name} ${courseNames.get(deck.course_id) ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => Number(b.course_id === suggestedCourseId) - Number(a.course_id === suggestedCourseId)
      || (courseNames.get(a.course_id) ?? "").localeCompare(courseNames.get(b.course_id) ?? "")
      || a.name.localeCompare(b.name));

  async function changeDecks(deckIds: string[]) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await saveAssignmentDeckLinks({
        assignmentId: isVirtual ? rootId : assignment.id,
        occurrenceDate: isOccurrence && scope !== "series" ? occurrenceDate : null,
        scope, deckIds,
      });
      if (result.error) setMessage(result.error);
      else onSaved();
    } catch {
      setMessage("Could not save study materials. Please refresh and try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function removeSchedule(scheduleId: string) {
    if (pending.current || !window.confirm("Unlink this study schedule from the assignment? The schedule and its study history will be kept.")) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await unlinkAssignmentStudySchedule({
        assignmentId: isVirtual ? rootId : assignment.id,
        occurrenceDate: isVirtual ? occurrenceDate : null,
        scheduleId,
      });
      if (result.error) setMessage(result.error);
      else onSaved();
    } catch {
      setMessage("Could not unlink the study schedule. Please refresh and try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const scheduleUrl = (deckId: string) => {
    const params = new URLSearchParams({ assignment: isVirtual ? rootId : assignment.id, deck: deckId });
    if (isVirtual) params.set("occurrence", occurrenceDate);
    return `/study-schedules/new?${params.toString()}`;
  };

  return (
    <section className="space-y-3 border-t border-border/80 pt-4" aria-labelledby="study-materials-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="study-materials-title" className="text-sm font-semibold text-ink">Study materials</h3>
          <p className="text-xs text-muted-foreground">Deck links save immediately. Save other assignment edits separately.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={busy}
          onClick={() => setPickerOpen((value) => !value)}>+ Add deck</Button>
      </div>

      {isOccurrence && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <legend className="mb-1 font-medium text-ink">Apply deck changes to</legend>
          {([ ["this", "This occurrence"], ["future", "This and future"], ["series", "Entire series"] ] as const)
            .map(([value, label]) => (
              <label key={value} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="deck-link-scope" checked={scope === value}
                  disabled={busy} onChange={() => setScope(value)} className="accent-primary" />{label}
              </label>
            ))}
        </fieldset>
      )}

      {message && <p role="alert" className="notice-error text-xs">{message}</p>}
      {activeDecks.length ? (
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {activeDecks.map((deck) => {
            const linkedSchedule = activeSchedules.find((schedule) => schedule.deck_id === deck.id);
            return (
              <li key={deck.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink truncate">{deck.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{courseNames.get(deck.course_id) ?? "Course unavailable"}</p>
                </div>
                <Link href={`/courses/${deck.course_id}/decks/${deck.id}`}
                  className={buttonVariants({ variant: "ghost", size: "sm", className: "text-xs" })}>Open deck</Link>
                <Button type="button" variant="ghost" size="sm" disabled={busy || Boolean(linkedSchedule)}
                  title={linkedSchedule ? "Unlink the study schedule first" : undefined}
                  onClick={() => void changeDecks(activeDeckIds.filter((id) => id !== deck.id))}>Remove</Button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-muted-foreground">No decks linked yet.</p>}

      {pickerOpen && (
        <div className="space-y-2 rounded-md bg-brand-50/70 p-3">
          <label htmlFor="planner-deck-search" className="text-xs font-medium text-ink">Find a deck</label>
          <Input id="planner-deck-search" type="search" value={search} disabled={busy}
            onChange={(event) => setSearch(event.target.value)} placeholder="Search deck or course" />
          {suggestedCourseId && <p className="text-xs text-muted-foreground">Decks from the linked course appear first.</p>}
          <ul className="max-h-44 overflow-y-auto divide-y divide-border/60">
            {availableDecks.map((deck) => (
              <li key={deck.id}>
                <button type="button" disabled={busy} onClick={() => void changeDecks([...activeDeckIds, deck.id])}
                  className="w-full py-2 text-left text-sm hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-primary">
                  <span className="font-medium">{deck.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{courseNames.get(deck.course_id)}</span>
                </button>
              </li>
            ))}
          </ul>
          {!availableDecks.length && <p className="text-xs text-muted-foreground">No other matching decks.</p>}
        </div>
      )}

      {(assignment.type_kind === "exam" || activeSchedules.length > 0) && (
        <div className="space-y-2 pt-1" aria-label="Study plan">
          <h4 className="text-xs font-semibold text-ink">Study plan</h4>
          {activeDecks.map((deck) => {
            const schedule = activeSchedules.find((item) => item.deck_id === deck.id);
            return <div key={deck.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="min-w-0 flex-1 font-medium text-ink">{deck.name}</span>
              {schedule ? <>
                <span className="text-muted-foreground">{schedule.name}</span>
                {scheduleProgress[schedule.id] && <span className="text-muted-foreground">
                  {scheduleProgress[schedule.id].completed} of {scheduleProgress[schedule.id].total} reviews completed
                </span>}
                <Link href={`/study-schedules/${schedule.id}`} className="underline underline-offset-2">Open schedule</Link>
                <Button type="button" variant="ghost" size="sm" disabled={busy}
                  onClick={() => void removeSchedule(schedule.id)}>Unlink</Button>
              </> : assignment.type_kind === "exam" ?
                <Link href={scheduleUrl(deck.id)} className="font-medium text-brand-ink underline underline-offset-2">Create study schedule</Link>
                : null}
            </div>;
          })}
        </div>
      )}
    </section>
  );
}
