import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type Rating = "review_again" | "needs_practice" | "mastered";

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
  const latestRatings = new Map<string, Rating>();
  let latestReviewAt: string | null = null;

  // Supabase limits returned rows, so page through history until every card has
  // a latest review or there are no more reviews for this deck.
  if (totalCards > 0) {
    const pageSize = 1000;
    for (let offset = 0; latestRatings.size < totalCards; offset += pageSize) {
      const { data, error } = await supabase
        .from("card_reviews")
        .select("card_id, rating, reviewed_at, cards!inner(deck_id)")
        .eq("user_id", userId)
        .eq("cards.deck_id", deckId)
        .order("reviewed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!data?.length) break;

      latestReviewAt ??= data[0].reviewed_at;
      for (const review of data) {
        if (!latestRatings.has(review.card_id)) {
          latestRatings.set(review.card_id, review.rating as Rating);
        }
      }
      if (data.length < pageSize) break;
    }
  }

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
    { label: "Total Cards", value: summary.totalCards },
    { label: "Mastered", value: summary.mastered },
    { label: "Needs Practice", value: summary.needsPractice },
    { label: "Review Again", value: summary.reviewAgain },
    { label: "Not Studied", value: summary.notStudied },
    { label: "Completed Sessions", value: summary.completedSessions },
  ];
  const lastStudied = summary.lastStudiedAt
    ? `${new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(summary.lastStudiedAt))} UTC`
    : "Not studied yet";

  return (
    <section aria-labelledby="deck-progress-heading" className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 id="deck-progress-heading" className="text-xl font-semibold text-slate-900">Study Progress</h2>
      <p className="mt-1 text-sm text-slate-600">Each card shows the result of its most recent review.</p>
      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-slate-50 p-4">
            <dt className="text-sm text-slate-600">{stat.label}</dt>
            <dd className="mt-2 text-2xl font-semibold text-slate-900">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-sm text-slate-600">Last studied: <time dateTime={summary.lastStudiedAt ?? undefined} className="font-medium text-slate-900">{lastStudied}</time></p>
    </section>
  );
}
