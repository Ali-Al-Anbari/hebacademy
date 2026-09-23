"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cardPairKey, validateImportCards } from "@/lib/cards/import";
import { createClient } from "@/lib/supabase/server";

const validId = (id: unknown) =>
  typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function importCards(courseId: string, deckId: string, cards: unknown) {
  const failure = (error: string) => ({ error, inserted: 0, skipped: 0 });
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;

  if (!validId(courseId) || !validId(deckId)) return failure("Could not verify this deck. Please try again.");
  const { data: deck, error: deckError } = await supabase
    .from("decks")
    .select("id")
    .eq("id", deckId)
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (deckError) console.error("Failed to verify deck for card import:", deckError);
  if (deckError || !deck) return failure("Could not verify this deck. Please try again.");

  const validated = validateImportCards(cards);
  if (!validated) return failure("Could not read the cards to import. Please preview them again.");
  if (validated.errorCount) return failure(`Correct ${validated.errorCount} invalid ${validated.errorCount === 1 ? "card" : "cards"} before importing.`);
  if (validated.limitExceeded) return failure("An import can contain at most 100 valid unique cards.");
  if (!validated.candidates.length) return failure("Add at least one valid question and answer.");

  // Page through existing cards so duplicate checks remain complete beyond PostgREST's row limit.
  const existingPairs = new Set<string>();
  let maxPosition = 0;
  const pageSize = 100;
  for (let offset = 0; ;) {
    const { data: cards, error, count } = await supabase
      .from("cards")
      .select("id, prompt, answer, position", { count: "exact" })
      .eq("deck_id", deckId)
      .eq("user_id", userId)
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error || count === null) {
      console.error("Failed to load existing cards for import:", error ?? "missing exact row count");
      return failure("Could not check existing cards. Please try again.");
    }
    for (const card of cards ?? []) {
      existingPairs.add(cardPairKey(card.prompt, card.answer));
      maxPosition = Math.max(maxPosition, card.position);
    }
    if (!cards?.length || offset + cards.length >= count) break;
    offset += cards.length;
  }

  const newCards = validated.candidates.filter((card) => !existingPairs.has(cardPairKey(card.prompt, card.answer)));
  const skipped = validated.duplicateCount + validated.candidates.length - newCards.length;
  if (!newCards.length) return { error: null, inserted: 0, skipped };
  if (maxPosition > 2_147_483_647 - newCards.length) return failure("This deck has no available card positions.");

  const { data: inserted, error: insertError } = await supabase
    .from("cards")
    .insert(newCards.map((card, index) => ({
      deck_id: deckId,
      user_id: userId,
      prompt: card.prompt,
      answer: card.answer,
      position: maxPosition + index + 1,
    })))
    .select("id");
  if (insertError) {
    console.error("Failed to import cards:", insertError);
    return failure("Cards could not be imported. Please try again.");
  }
  if (inserted?.length !== newCards.length) {
    console.error("Card import returned an unexpected inserted count:", { expected: newCards.length, actual: inserted?.length });
    return failure("Could not confirm the import. Refresh the deck before trying again.");
  }

  revalidatePath(`/courses/${courseId}/decks/${deckId}`);
  return { error: null, inserted: inserted.length, skipped };
}
