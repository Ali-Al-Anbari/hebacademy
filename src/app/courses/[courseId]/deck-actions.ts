"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  return { supabase, userId: data.claims.sub };
}

function deckFields(name: string, description: string) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedDescription = typeof description === "string" ? description.trim() : "";
  if (!trimmedName || trimmedName.length > 120) {
    return { error: "Enter a deck name of 1 to 120 characters." };
  }
  if (trimmedDescription.length > 1000) {
    return { error: "Keep the description under 1,000 characters." };
  }
  return { name: trimmedName, description: trimmedDescription || null };
}

export async function createDeck(courseId: string, name: string, description: string) {
  const { supabase, userId } = await authenticatedClient();
  if (typeof courseId !== "string" || !validId(courseId)) {
    return { error: "Could not add the deck. Please try again." };
  }
  const fields = deckFields(name, description);
  if (fields.error) return { error: fields.error };

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (courseError || !course) {
    if (courseError) console.error("Failed to verify deck course:", courseError);
    return { error: "Could not add the deck. Please try again." };
  }

  const { error } = await supabase.from("decks").insert({
    course_id: courseId,
    user_id: userId,
    name: fields.name,
    description: fields.description,
  });
  if (error) {
    console.error("Failed to create deck:", error);
    return { error: "Could not add the deck. Please try again." };
  }

  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/");
  return { error: null };
}

export async function updateDeck(courseId: string, deckId: string, name: string, description: string) {
  const { supabase, userId } = await authenticatedClient();
  if (typeof courseId !== "string" || !validId(courseId) || typeof deckId !== "string" || !validId(deckId)) {
    return { error: "Could not save the deck. Please try again." };
  }
  const fields = deckFields(name, description);
  if (fields.error) return { error: fields.error };

  const { data, error } = await supabase
    .from("decks")
    .update({
      name: fields.name,
      description: fields.description,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deckId)
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to update deck:", error);
    return { error: "Could not save the deck. Please try again." };
  }

  revalidatePath(`/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}/decks/${deckId}`);
  return { error: null };
}

export async function deleteDeck(courseId: string, deckId: string) {
  const { supabase, userId } = await authenticatedClient();
  if (typeof courseId !== "string" || !validId(courseId) || typeof deckId !== "string" || !validId(deckId)) {
    return { error: "Could not delete the deck. Please try again." };
  }

  const { data, error } = await supabase
    .from("decks")
    .delete()
    .eq("id", deckId)
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to delete deck:", error);
    return { error: "Could not delete the deck. Please try again." };
  }

  revalidatePath(`/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}/decks/${deckId}`);
  revalidatePath("/");
  return { error: null };
}
