import type { createClient } from "@/lib/supabase/server";
import type { StudyRating } from "@/lib/study-filter";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function getOwnedStudyCards(supabase: SupabaseClient, deckId: string, userId: string) {
  const cards: {
    id: string;
    prompt: string;
    answer: string;
    prompt_image_path: string | null;
    answer_image_path: string | null;
    is_starred: boolean;
    position: number;
  }[] = [];
  const pageSize = 1000;
  for (let offset = 0; ;) {
    const { data, count, error } = await supabase.from("cards")
      .select("id, prompt, answer, prompt_image_path, answer_image_path, is_starred, position", { count: "exact" })
      .eq("deck_id", deckId).eq("user_id", userId)
      .order("position", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error || count === null) throw error ?? new Error("Missing study card count");
    cards.push(...(data ?? []));
    if (offset + (data?.length ?? 0) >= count) break;
    if (!data?.length) throw new Error("Study card query stopped before all cards were loaded");
    offset += data.length;
  }
  return cards;
}

export async function getLatestDeckRatings(
  supabase: SupabaseClient, deckId: string, userId: string, totalCards: number,
) {
  const ratings = new Map<string, StudyRating>();
  let latestReviewAt: string | null = null;
  if (totalCards === 0) return { ratings, latestReviewAt };

  const pageSize = 1000;
  for (let offset = 0; ratings.size < totalCards;) {
    const { data, count, error } = await supabase.from("card_reviews")
      .select("card_id, rating, reviewed_at, cards!inner(deck_id)", { count: "exact" })
      .eq("user_id", userId).eq("cards.deck_id", deckId)
      .order("reviewed_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error || count === null) throw error ?? new Error("Missing review count");
    if (!data?.length) {
      if (offset < count) throw new Error("Review query stopped before all reviews were loaded");
      break;
    }
    latestReviewAt ??= data[0].reviewed_at;
    for (const review of data) {
      if (!ratings.has(review.card_id)) ratings.set(review.card_id, review.rating as StudyRating);
    }
    offset += data.length;
    if (offset >= count) break;
  }
  return { ratings, latestReviewAt };
}

export async function getSessionRatings(supabase: SupabaseClient, sessionId: string, userId: string) {
  const ratings = new Map<string, StudyRating>();
  const pageSize = 1000;
  for (let offset = 0; ;) {
    const { data, count, error } = await supabase.from("card_reviews")
      .select("card_id, rating", { count: "exact" })
      .eq("study_session_id", sessionId).eq("user_id", userId)
      .order("reviewed_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error || count === null) throw error ?? new Error("Missing study review count");
    for (const review of data ?? []) {
      if (!ratings.has(review.card_id)) ratings.set(review.card_id, review.rating as StudyRating);
    }
    if (offset + (data?.length ?? 0) >= count) break;
    if (!data?.length) throw new Error("Study review query stopped before all reviews were loaded");
    offset += data.length;
  }
  return ratings;
}
