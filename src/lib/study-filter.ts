export type StudyRating = "review_again" | "needs_practice" | "mastered";
export type StudyFilter = "all" | "starred" | "review_again" | "needs_practice" | "not_studied";

export function selectStudyCardIds(
  cards: { id: string; is_starred: boolean }[], ratings: Map<string, StudyRating>, filter: StudyFilter,
) {
  return cards.filter((card) => {
    if (filter === "all") return true;
    if (filter === "starred") return card.is_starred;
    if (filter === "not_studied") return !ratings.has(card.id);
    return ratings.get(card.id) === filter;
  }).map((card) => card.id);
}

export function resolveSessionCards<Card extends { id: string }>(cards: Card[], selectedIds: string[] | null) {
  if (selectedIds === null) return cards;
  if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length) return null;
  const byId = new Map(cards.map((card) => [card.id, card]));
  const selected = selectedIds.map((id) => byId.get(id));
  if (selected.some((card) => !card)) return null;
  return selected as Card[];
}
