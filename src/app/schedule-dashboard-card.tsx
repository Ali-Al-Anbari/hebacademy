"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
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
    <Card className="py-0 transition-colors hover:border-[#c9a1b1]">
      <CardContent className="space-y-2 p-5">
        <Link href={`/study-schedules/${id}`} className="block rounded-sm font-semibold text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{name}</Link>
        <p className="text-sm text-muted-foreground">{course} · {deck} · {cardCount} {cardCount === 1 ? "card" : "cards"}</p>
        <p className="text-sm text-foreground">{completed} of {dates.length} reviews completed{examDate ? ` · Exam: ${formatCalendarDate(examDate)}` : ""}</p>
        {today && <p className="text-sm font-medium text-foreground">{dueToday ? "Due today" : next ? `Next review: ${formatCalendarDate(next.reviewDate)}` : dates.length && !incomplete.length ? "All reviews completed" : "No upcoming reviews"}{overdue > 0 ? ` · ${overdue} overdue` : ""}</p>}
      </CardContent>
    </Card>
  );
}
