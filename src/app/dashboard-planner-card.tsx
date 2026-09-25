"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useLocalToday } from "@/lib/local-calendar";
import {
  addDays,
  displayTime,
  formatShortDate,
  weekdayOf,
  WEEKDAY_SHORT,
} from "@/lib/planner/dates";
import { cn } from "@/lib/utils";
import {
  getPlannerDashboardSummary,
  type PlannerDashboardSummary,
  type PlannerSummaryItem,
} from "./dashboard-planner-actions";
import {
  toggleAssignmentStatus,
  toggleSubtask,
} from "./planner/assignment-actions";

const MAX_VISIBLE_NEXT_3_DAYS = 7;
const MAX_VISIBLE_OVERDUE = 4;

export function DashboardPlannerCard() {
  const today = useLocalToday();
  const [summary, setSummary] = useState<PlannerDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<{
    next3Days: PlannerSummaryItem[];
    overdue: PlannerSummaryItem[];
  }>({ next3Days: [], overdue: [] });
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!today) return;
    let cancelled = false;

    async function fetchSummary(targetDate: string) {
      setLoading(true);
      try {
        const res = await getPlannerDashboardSummary(targetDate);
        if (!cancelled && res.data) {
          setSummary(res.data);
          setItems({
            next3Days: res.data.next3Days,
            overdue: res.data.overdue,
          });
        }
      } catch (err) {
        console.error("Failed to load planner dashboard summary:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchSummary(today);

    return () => {
      cancelled = true;
    };
  }, [today]);

  function handleToggle(item: PlannerSummaryItem) {
    const isNowDone = !item.isDone;

    // Optimistically update
    setItems((prev) => {
      const updateList = (list: PlannerSummaryItem[]) =>
        list
          .map((i) => (i.id === item.id ? { ...i, isDone: isNowDone } : i))
          .filter((i) => !i.isDone); // Hide completed item immediately

      return {
        next3Days: updateList(prev.next3Days),
        overdue: updateList(prev.overdue),
      };
    });

    startTransition(async () => {
      try {
        if (item.kind === "assignment") {
          const res = await toggleAssignmentStatus(
            item.assignmentId,
            item.status
          );
          if (res.error) throw new Error(res.error);
        } else {
          const res = await toggleSubtask(
            item.id,
            item.assignmentId,
            item.isDone
          );
          if (res.error) throw new Error(res.error);
        }
      } catch (err) {
        console.error("Failed to update item status:", err);
        // Roll back on error
        setItems((prev) => {
          const restoreItem = (list: PlannerSummaryItem[]) => {
            if (list.some((i) => i.id === item.id)) {
              return list.map((i) =>
                i.id === item.id ? { ...i, isDone: item.isDone } : i
              );
            }
            return [...list, item];
          };
          return {
            next3Days: restoreItem(prev.next3Days),
            overdue: restoreItem(prev.overdue),
          };
        });
      }
    });
  }

  // SSR / Initial loading skeleton
  if (!today || (loading && !summary)) {
    return (
      <section
        className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs"
        aria-label="Academic Planner"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border/70">
          <div>
            <p className="text-[0.7rem] font-bold tracking-wider uppercase text-brand-ink">
              Planner
            </p>
            <h2 className="text-base font-semibold text-foreground">
              Next 3 Days
            </h2>
          </div>
          <Link
            href="/planner"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
          >
            View planner <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="space-y-3 pt-4 animate-pulse">
          <div className="h-3 w-20 bg-muted/60 rounded" />
          <div className="h-9 w-full bg-muted/40 rounded-lg" />
          <div className="h-9 w-full bg-muted/40 rounded-lg" />
        </div>
      </section>
    );
  }

  // Empty state: No semesters exist
  if (!summary?.hasSemesters) {
    return (
      <section
        className="rounded-xl border border-border/80 bg-card p-5 shadow-xs"
        aria-label="Academic Planner"
      >
        <p className="text-[0.7rem] font-bold tracking-wider uppercase text-brand-ink">
          Academic Planner
        </p>
        <h2 className="text-base font-semibold text-foreground mt-0.5">
          Plan your semester
        </h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Organize courses, class schedules, assignments, and daily study work.
        </p>
        <Link
          href="/planner"
          className={buttonVariants({
            variant: "secondary",
            size: "sm",
            className:
              "mt-3.5 w-full bg-brand-200 hover:bg-brand-300 text-xs font-semibold",
          })}
        >
          Set up planner →
        </Link>
      </section>
    );
  }

  // Empty state: All semesters archived
  if (summary.hasSemesters && !summary.hasActiveSemesters) {
    return (
      <section
        className="rounded-xl border border-border/80 bg-card p-5 shadow-xs"
        aria-label="Academic Planner"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border/70">
          <div>
            <p className="text-[0.7rem] font-bold tracking-wider uppercase text-brand-ink">
              Planner
            </p>
            <h2 className="text-base font-semibold text-foreground">
              Next 3 Days
            </h2>
          </div>
          <Link
            href="/planner"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
          >
            View planner <ArrowRight className="size-3" />
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          All planner semesters are currently archived.
        </p>
        <Link
          href="/planner"
          className="mt-2 inline-block text-xs font-semibold text-brand-ink hover:underline"
        >
          Manage semesters →
        </Link>
      </section>
    );
  }

  const tomorrow = addDays(today, 1);
  const day3 = addDays(today, 2);

  const visibleNext3Days = items.next3Days.slice(0, MAX_VISIBLE_NEXT_3_DAYS);
  const extraNext3Days = Math.max(
    0,
    items.next3Days.length - MAX_VISIBLE_NEXT_3_DAYS
  );

  const visibleOverdue = items.overdue.slice(0, MAX_VISIBLE_OVERDUE);
  const extraOverdue = Math.max(0, items.overdue.length - MAX_VISIBLE_OVERDUE);

  // Group Next 3 Days by calendar day (filter out empty groups)
  const groups = [
    {
      date: today,
      label: `TODAY · ${formatShortDate(today).toUpperCase()}`,
      items: visibleNext3Days.filter((i) => i.dueDate === today),
    },
    {
      date: tomorrow,
      label: `TOMORROW · ${formatShortDate(tomorrow).toUpperCase()}`,
      items: visibleNext3Days.filter((i) => i.dueDate === tomorrow),
    },
    {
      date: day3,
      label: `${WEEKDAY_SHORT[weekdayOf(day3) - 1].toUpperCase()} · ${formatShortDate(day3).toUpperCase()}`,
      items: visibleNext3Days.filter((i) => i.dueDate === day3),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <section
      className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs"
      aria-labelledby="dashboard-planner-title"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border/70">
        <div>
          <p className="text-[0.7rem] font-bold tracking-wider uppercase text-brand-ink">
            Planner
          </p>
          <h2
            id="dashboard-planner-title"
            className="text-base font-semibold text-foreground"
          >
            Next 3 Days
          </h2>
        </div>
        <Link
          href="/planner"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
        >
          View planner <ArrowRight className="size-3" />
        </Link>
      </div>

      {/* OVERDUE Section (rendered ONLY if overdue items exist) */}
      {visibleOverdue.length > 0 && (
        <div className="mt-3 rounded-lg bg-rose-50/70 border border-rose-200/80 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-800 uppercase tracking-wide">
              <AlertTriangle className="size-3.5 text-rose-600" />
              <span>Overdue</span>
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-rose-200/80 text-[0.65rem] text-rose-900 leading-none">
                {items.overdue.length}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            {visibleOverdue.map((item) => (
              <DashboardPlannerItemRow
                key={`${item.kind}-${item.id}`}
                item={item}
                isOverdue
                onToggle={handleToggle}
              />
            ))}
          </div>
          {extraOverdue > 0 && (
            <div className="mt-2 pt-2 border-t border-rose-200/60 flex items-center justify-between text-xs text-rose-800">
              <span>+{extraOverdue} more</span>
              <Link
                href="/planner"
                className="font-semibold underline hover:text-rose-900"
              >
                View all →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* NEXT 3 DAYS Section */}
      <div className="pt-3 space-y-3.5">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center sm:text-left">
            Nothing due in the next 3 days.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.date} className="space-y-1.5">
              <p className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <DashboardPlannerItemRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* + More Upcoming Footer */}
      {extraNext3Days > 0 && (
        <div className="mt-3 pt-3 border-t border-border/70 flex items-center justify-between text-xs text-muted-foreground">
          <span>+{extraNext3Days} more upcoming</span>
          <Link
            href="/planner"
            className="font-semibold text-brand-ink hover:underline"
          >
            View all in planner →
          </Link>
        </div>
      )}
    </section>
  );
}

function DashboardPlannerItemRow({
  item,
  isOverdue,
  onToggle,
}: {
  item: PlannerSummaryItem;
  isOverdue?: boolean;
  onToggle: (item: PlannerSummaryItem) => void;
}) {
  return (
    <div className="group flex items-start gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-brand-100/60">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.isDone}
        aria-label={`Mark "${item.title}" ${item.isDone ? "incomplete" : "complete"}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle(item);
        }}
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-2 focus-visible:outline-brand-ink",
          item.isDone
            ? "border-brand-ink bg-brand-ink text-white"
            : "border-muted-foreground/40 hover:border-brand-ink bg-background"
        )}
      >
        {item.isDone && <Check className="size-3 stroke-[3]" />}
      </button>

      <Link
        href={`/planner?assignment=${item.assignmentId}`}
        className="min-w-0 flex-1 block focus-visible:outline-none"
      >
        <div className="flex items-baseline justify-between gap-1.5">
          <div className="flex items-center gap-1 min-w-0">
            {item.isImportant && (
              <span
                title="Important"
                className="inline-flex size-3.5 shrink-0 items-center justify-center rounded bg-rose-100 text-[0.65rem] font-bold text-rose-700"
              >
                !
              </span>
            )}
            <span
              className={cn(
                "text-xs font-medium text-foreground truncate group-hover:text-brand-ink group-hover:underline",
                item.isDone && "line-through text-muted-foreground"
              )}
            >
              {item.title}
            </span>
          </div>

          {/* Right indicator: Overdue date or due time */}
          {isOverdue ? (
            <span className="shrink-0 text-[0.68rem] font-semibold text-rose-700">
              {formatShortDate(item.dueDate)}
            </span>
          ) : item.dueTime ? (
            <span className="shrink-0 text-[0.68rem] text-muted-foreground">
              {displayTime(item.dueTime)}
            </span>
          ) : null}
        </div>

        {/* Subtask breadcrumb and course pill */}
        <div className="flex items-center gap-2 mt-0.5">
          {item.kind === "subtask" && item.parentAssignmentTitle && (
            <span className="text-[0.65rem] text-muted-foreground truncate">
              ↳ {item.parentAssignmentTitle}
            </span>
          )}
          {item.courseName && (
            <span
              className="text-[0.65rem] font-medium px-1 rounded truncate max-w-[120px]"
              style={{
                backgroundColor: `${item.courseColor ?? "#FB6F92"}20`,
                color: item.courseColor ?? "inherit",
              }}
            >
              {item.courseName}
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
