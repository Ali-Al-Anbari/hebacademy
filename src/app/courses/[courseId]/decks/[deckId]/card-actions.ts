"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const pagePath = (courseId: string, deckId: string) =>
  `/courses/${courseId}/decks/${deckId}`;

async function auth() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  return { supabase, userId: data.claims.sub };
}

async function ownedDeck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  courseId: string,
  deckId: string,
) {
  if (typeof courseId !== "string" || !validId(courseId) || typeof deckId !== "string" || !validId(deckId)) return false;
  const { data, error } = await supabase
    .from("decks")
    .select("id")
    .eq("id", deckId)
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) console.error("Failed to verify card deck:", error);
  return !error && Boolean(data);
}

function cardText(prompt: string, answer: string) {
  const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  const trimmedAnswer = typeof answer === "string" ? answer.trim() : "";
  if (!trimmedPrompt || !trimmedAnswer) return null;
  if (trimmedPrompt.length > 5000 || trimmedAnswer.length > 5000) return null;
  return { prompt: trimmedPrompt, answer: trimmedAnswer };
}

function validImagePath(path: string | null, userId: string, deckId: string, cardId: string) {
  return path === null || (
    typeof path === "string" &&
    path.startsWith(`${userId}/${deckId}/${cardId}/`) &&
    /^[0-9a-f-]+\.(?:jpg|png|webp|gif)$/i.test(path.split("/").at(-1) ?? "")
  );
}

export async function createCard(courseId: string, deckId: string, prompt: string, answer: string) {
  const { supabase, userId } = await auth();
  const text = cardText(prompt, answer);
  if (!text) return { error: "Enter a prompt and answer (up to 5,000 characters each).", id: null };
  if (!await ownedDeck(supabase, userId, courseId, deckId)) {
    return { error: "Could not add the card. Please try again.", id: null };
  }

  const { data: last, error: orderError } = await supabase
    .from("cards")
    .select("position")
    .eq("deck_id", deckId)
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) {
    console.error("Failed to find next card position:", orderError);
    return { error: "Could not add the card. Please try again.", id: null };
  }

  const { data, error } = await supabase
    .from("cards")
    .insert({ ...text, deck_id: deckId, user_id: userId, position: (last?.position ?? 0) + 1 })
    .select("id")
    .single();
  if (error) {
    console.error("Failed to create card:", error);
    return { error: "Could not add the card. Please try again.", id: null };
  }
  revalidatePath(pagePath(courseId, deckId));
  return { error: null, id: data.id as string };
}

export async function saveCard(
  courseId: string, deckId: string, cardId: string,
  prompt: string, answer: string,
  promptImagePath: string | null, answerImagePath: string | null,
) {
  const { supabase, userId } = await auth();
  const text = cardText(prompt, answer);
  if (!text) return { error: "Enter a prompt and answer (up to 5,000 characters each)." };
  if (!await ownedDeck(supabase, userId, courseId, deckId) || typeof cardId !== "string" || !validId(cardId)) {
    return { error: "Could not save the card. Please try again." };
  }
  if (!validImagePath(promptImagePath, userId, deckId, cardId) || !validImagePath(answerImagePath, userId, deckId, cardId)) {
    return { error: "Could not save the card. Please try again." };
  }

  const { data: previous, error: readError } = await supabase
    .from("cards")
    .select("prompt_image_path, answer_image_path")
    .eq("id", cardId).eq("deck_id", deckId).eq("user_id", userId)
    .maybeSingle();
  if (readError || !previous) {
    if (readError) console.error("Failed to load card before update:", readError);
    return { error: "Could not save the card. Please try again." };
  }

  const { data, error } = await supabase
    .from("cards")
    .update({ ...text, prompt_image_path: promptImagePath, answer_image_path: answerImagePath, updated_at: new Date().toISOString() })
    .eq("id", cardId).eq("deck_id", deckId).eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to update card:", error);
    return { error: "Could not save the card. Please try again." };
  }

  const oldPaths = [previous.prompt_image_path, previous.answer_image_path]
    .filter((path): path is string => Boolean(path) && path !== promptImagePath && path !== answerImagePath);
  if (oldPaths.length) {
    const { error: storageError } = await supabase.storage.from("card-images").remove(oldPaths);
    if (storageError) console.error("Failed to remove replaced card images:", storageError);
  }
  revalidatePath(pagePath(courseId, deckId));
  return { error: null };
}

export async function deleteCard(courseId: string, deckId: string, cardId: string) {
  const { supabase, userId } = await auth();
  if (!await ownedDeck(supabase, userId, courseId, deckId) || typeof cardId !== "string" || !validId(cardId)) {
    return { error: "Could not delete the card. Please try again." };
  }

  const { data, error } = await supabase
    .from("cards")
    .delete()
    .eq("id", cardId).eq("deck_id", deckId).eq("user_id", userId)
    .select("prompt_image_path, answer_image_path")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to delete card:", error);
    return { error: "Could not delete the card. Please try again." };
  }
  const paths = [data.prompt_image_path, data.answer_image_path].filter((path): path is string => Boolean(path));
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from("card-images").remove(paths);
    if (storageError) console.error("Failed to remove deleted card images:", storageError);
  }
  revalidatePath(pagePath(courseId, deckId));
  return { error: null };
}

export async function setCardStar(courseId: string, deckId: string, cardId: string, starred: boolean) {
  const { supabase, userId } = await auth();
  if (!await ownedDeck(supabase, userId, courseId, deckId) || typeof cardId !== "string" || !validId(cardId) || typeof starred !== "boolean") {
    return { error: "Could not update the card. Please try again." };
  }
  const { data, error } = await supabase
    .from("cards")
    .update({ is_starred: starred, updated_at: new Date().toISOString() })
    .eq("id", cardId).eq("deck_id", deckId).eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to star card:", error);
    return { error: "Could not update the card. Please try again." };
  }
  revalidatePath(pagePath(courseId, deckId));
  return { error: null };
}

export async function moveCard(courseId: string, deckId: string, cardId: string, direction: "up" | "down") {
  const { supabase, userId } = await auth();
  if (!await ownedDeck(supabase, userId, courseId, deckId) || typeof cardId !== "string" || !validId(cardId) || !["up", "down"].includes(direction)) {
    return { error: "Could not move the card. Please try again." };
  }
  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("id")
    .eq("id", cardId).eq("deck_id", deckId).eq("user_id", userId)
    .maybeSingle();
  if (cardError || !card) {
    if (cardError) console.error("Failed to verify card before move:", cardError);
    return { error: "Could not move the card. Please try again." };
  }
  const { data, error } = await supabase.rpc("move_card", { p_card_id: cardId, p_direction: direction });
  if (error || !data) {
    if (error) console.error("Failed to move card:", error);
    return { error: "Could not move the card. Please try again." };
  }
  revalidatePath(pagePath(courseId, deckId));
  return { error: null };
}
