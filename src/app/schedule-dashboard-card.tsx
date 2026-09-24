"use client";

import Link from "next/link";
import { useLocalToday } from "@/lib/local-calendar";
import { formatCalendarDate } from "@/lib/schedules";

export function ScheduleDashboardCard({ id, name, course, deck, cardCount, examDate, dates }: {
  id: string; name: string; course: string; deck: string; cardCount: number;
  examDate: string | null;
  dates: { reviewDate: string; completed: boolean }[];
}) {
  const today = useLocalToday();
  const incomplete = dates.filter((date) => !date.completed);
  const completed = dates.length - incomplete.length;
  const overdue = today ? incomplete.filter((date) => date.reviewDate < today).length : 0;
  const dueToday = today ? incomplete.some((date) => date.reviewDate === today) : false;
  const next = today ? incomplete.find((date) => date.reviewDate >= today) : null;
  return (
    <article className="schedule-row flex flex-col gap-2 px-1 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5 sm:px-2">
      <div className="min-w-0">
        <Link href={`/study-schedules/${id}`} className="block break-words rounded-sm font-heading text-lg font-semibold leading-snug text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{name}</Link>
        <p className="mt-1 text-sm text-muted-foreground">{course} · {deck} · {cardCount} {cardCount === 1 ? "card" : "cards"}</p>
        <p className="mt-1 text-sm text-foreground">{completed} of {dates.length} reviews completed{examDate ? ` · Exam: ${formatCalendarDate(examDate)}` : ""}</p>
      </div>
      {today && <p className="shrink-0 text-sm font-semibold text-foreground">{dueToday ? "Due today" : next ? `Next: ${formatCalendarDate(next.reviewDate)}` : dates.length && !incomplete.length ? "All reviews completed" : "No upcoming reviews"}{overdue > 0 ? ` · ${overdue} overdue` : ""}</p>}
    </article>
  );
}
