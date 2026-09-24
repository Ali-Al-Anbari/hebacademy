"use client";

import { useState } from "react";
import Link from "next/link";
import { Circle, Layers3, RotateCcw, Star, Target } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StudyFilter } from "@/lib/study-filter";
import { startStudy } from "./actions";
import { StartStudyButton } from "./start-button";

type FilterCounts = Record<StudyFilter, number>;

export function StudySelection({ courseId, deckId, counts, resumes }: {
  courseId: string;
  deckId: string;
  counts: FilterCounts;
  resumes: Partial<Record<StudyFilter, string>>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<StudyFilter>("all");
  const options = [
    { value: "all", label: "All Cards", icon: Layers3 },
    { value: "starred", label: "Starred", icon: Star },
    { value: "review_again", label: "Review Again", icon: RotateCcw },
    { value: "needs_practice", label: "Needs Practice", icon: Target },
    { value: "not_studied", label: "Not Studied", icon: Circle },
  ] as const;

  return <>
    <Button type="button" size="lg" className="w-full sm:w-auto" onClick={() => setOpen(true)}>Study Flashcards</Button>
    <Button type="button" variant="secondary" size="lg" className="order-3 w-full bg-brand-200 hover:bg-brand-300 sm:w-auto" onClick={() => setOpen(true)}>Smart Study</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose cards to study</DialogTitle>
          <DialogDescription>Select one group for this session. Cards stay in the group you start with, even after you rate them.</DialogDescription>
        </DialogHeader>
        <form action={startStudy.bind(null, courseId, deckId)} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="sr-only">Study group</legend>
            {options.map(({ value, label, icon: Icon }) => <label key={value} className={`mode-option flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring ${selected === value ? "border-primary bg-brand-50" : "border-border bg-white"}`}>
              <input type="radio" name="filter" value={value} checked={selected === value} onChange={() => setSelected(value)} className="sr-only" />
              <Icon aria-hidden="true" className={`size-4 shrink-0 ${value === "not_studied" ? "text-muted-foreground" : "text-brand-ink"}`} />
              <span className="flex-1 text-sm font-medium">{label}</span>
              <span className="text-sm tabular-nums text-muted-foreground">{counts[value]}</span>
            </label>)}
          </fieldset>
          {counts[selected] === 0 && <p role="status" className="text-sm text-muted-foreground">No cards in this group yet. Choose another group to start studying.</p>}
          {resumes[selected] && <Link href={resumes[selected]} className={buttonVariants({ variant: "secondary", className: "w-full" })}>Resume {options.find((option) => option.value === selected)?.label} session</Link>}
          <StartStudyButton disabled={counts[selected] === 0} label="Start Study" />
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
