import { createClient } from "@/lib/supabase/server";
import { getLatestDeckRatings } from "@/lib/study-data";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type DeckProgressSummary = {
  totalCards: number;
  mastered: number;
  needsPractice: number;
  reviewAgain: number;
  notStudied: number;
  completedSessions: number;
  lastStudiedAt: string | null;
};

export async function getDeckProgress(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  totalCards: number,
): Promise<DeckProgressSummary> {
  const { ratings: latestRatings, latestReviewAt } = await getLatestDeckRatings(supabase, deckId, userId, totalCards);

  const { data: sessions, count, error: sessionsError } = await supabase
    .from("study_sessions")
    .select("completed_at", { count: "exact" })
    .eq("user_id", userId)
    .eq("deck_id", deckId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1);
  if (sessionsError) throw sessionsError;

  const ratings = [...latestRatings.values()];
  const latestCompletedAt = sessions?.[0]?.completed_at ?? null;
  let lastStudiedAt = latestReviewAt ?? latestCompletedAt;
  if (latestCompletedAt && lastStudiedAt && Date.parse(latestCompletedAt) > Date.parse(lastStudiedAt)) {
    lastStudiedAt = latestCompletedAt;
  }
  return {
    totalCards,
    mastered: ratings.filter((rating) => rating === "mastered").length,
    needsPractice: ratings.filter((rating) => rating === "needs_practice").length,
    reviewAgain: ratings.filter((rating) => rating === "review_again").length,
    notStudied: totalCards - latestRatings.size,
    completedSessions: count ?? 0,
    lastStudiedAt,
  };
}

export function DeckProgress({ summary }: { summary: DeckProgressSummary }) {
  const stats = [
    { label: "Mastered", value: summary.mastered, tone: "mastered" },
    { label: "Needs Practice", value: summary.needsPractice, tone: "practice" },
    { label: "Review Again", value: summary.reviewAgain, tone: "again" },
    { label: "Not Studied", value: summary.notStudied, tone: "neutral" },
  ];
  const lastStudied = summary.lastStudiedAt
    ? `${new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(summary.lastStudiedAt))} UTC`
    : "Not studied yet";

  return (
    <section aria-labelledby="deck-progress-heading" className="mt-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="deck-progress-heading" className="section-title">Study progress</h2><p className="section-meta">Current status from each card’s latest review.</p></div><p className="text-sm text-muted-foreground">Last studied <time dateTime={summary.lastStudiedAt ?? undefined} className="font-medium text-foreground">{lastStudied}</time></p></div>
      <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${summary.mastered} mastered, ${summary.needsPractice} needs practice, ${summary.reviewAgain} review again, ${summary.notStudied} not studied`}>
        {summary.totalCards > 0 && <><span className="bg-brand-400" style={{ width: `${summary.mastered / summary.totalCards * 100}%` }} /><span className="bg-brand-300" style={{ width: `${summary.needsPractice / summary.totalCards * 100}%` }} /><span className="bg-brand-200" style={{ width: `${summary.reviewAgain / summary.totalCards * 100}%` }} /></>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{stats.map((stat) => <div key={stat.label} className={`progress-stat progress-stat--${stat.tone}`}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>
      <p className="mt-4 text-sm text-muted-foreground">{summary.totalCards} total {summary.totalCards === 1 ? "card" : "cards"} · {summary.completedSessions} completed {summary.completedSessions === 1 ? "session" : "sessions"}</p>
    </section>
  );
}
