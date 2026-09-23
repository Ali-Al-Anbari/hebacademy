"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnedStudyCards } from "@/lib/study-data";
import { isCalendarDate, type ScheduleDraft } from "@/lib/schedules";
import { createClient } from "@/lib/supabase/server";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

async function ownedDeck(courseId: string, deckId: string) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;
  if (!validId(courseId) || !validId(deckId)) return null;

  const { data: course, error: courseError } = await supabase.from("courses")
    .select("id").eq("id", courseId).eq("user_id", userId).maybeSingle();
  if (courseError) console.error("Failed to verify schedule course:", courseError);
  if (courseError || !course) return null;

  const { data: deck, error: deckError } = await supabase.from("decks")
    .select("id").eq("id", deckId).eq("course_id", courseId)
    .eq("user_id", userId).maybeSingle();
  if (deckError) console.error("Failed to verify schedule deck:", deckError);
  if (deckError || !deck) return null;
  return { supabase, userId };
}

export async function loadScheduleDeckCards(courseId: string, deckId: string) {
  if (typeof courseId !== "string" || typeof deckId !== "string") {
    return { error: "Choose a valid deck.", cards: [] };
  }
  const context = await ownedDeck(courseId, deckId);
  if (!context) return { error: "This deck is unavailable.", cards: [] };
  try {
    const cards = await getOwnedStudyCards(context.supabase, deckId, context.userId);
    return {
      error: null,
      cards: cards.map(({ id, prompt, answer, is_starred }) => ({
        id, prompt, answer, is_starred,
      })),
    };
  } catch (error) {
    console.error("Failed to load schedule cards:", error);
    return { error: "Could not load this deck's cards. Try again.", cards: [] };
  }
}

export async function createSchedule(input: ScheduleDraft) {
  const failure = (error: string) => ({ error, scheduleId: null as string | null });
  if (!input || typeof input !== "object") return failure("Complete the schedule form first.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!name || name.length > 120) return failure("Enter a schedule name of 1 to 120 characters.");
  if (typeof input.description !== "string" || description.length > 1000) {
    return failure("Keep the description under 1,000 characters.");
  }
  if (typeof input.courseId !== "string" || typeof input.deckId !== "string") {
    return failure("Choose a course and deck.");
  }
  if (typeof input.examDate !== "string" || (input.examDate && !isCalendarDate(input.examDate))) {
    return failure("Enter a valid exam date or leave it blank.");
  }
  if (!["all", "starred", "manual"].includes(input.selectionMode)) {
    return failure("Choose how to select cards.");
  }
  if (!Array.isArray(input.manualCardIds) || !Array.isArray(input.reviewDates)
      || !input.manualCardIds.every((id) => typeof id === "string" && validId(id))
      || !input.reviewDates.every((date) => typeof date === "string" && isCalendarDate(date))) {
    return failure("Check the selected cards and review dates.");
  }
  if (new Set(input.manualCardIds).size !== input.manualCardIds.length) {
    return failure("The card selection contains duplicates.");
  }
  if (new Set(input.reviewDates).size !== input.reviewDates.length) {
    return failure("Remove duplicate review dates.");
  }

  const context = await ownedDeck(input.courseId, input.deckId);
  if (!context) return failure("This course or deck is unavailable.");

  let cards: Awaited<ReturnType<typeof getOwnedStudyCards>>;
  try {
    cards = await getOwnedStudyCards(context.supabase, input.deckId, context.userId);
  } catch (error) {
    console.error("Failed to verify schedule cards:", error);
    return failure("Could not verify this deck's cards. Try again.");
  }
  const ownedIds = new Set(cards.map((card) => card.id));
  if (input.manualCardIds.some((id) => !ownedIds.has(id))) {
    return failure("One or more selected cards are no longer in this deck.");
  }
  const selectedIds = input.selectionMode === "all"
    ? cards.map((card) => card.id)
    : input.selectionMode === "starred"
      ? cards.filter((card) => card.is_starred).map((card) => card.id)
      : input.manualCardIds;

  const { data: schedule, error: scheduleError } = await context.supabase
    .from("study_schedules")
    .insert({
      user_id: context.userId,
      deck_id: input.deckId,
      name,
      description: description || null,
      exam_date: input.examDate || null,
    })
    .select("id").single();
  if (scheduleError || !schedule) {
    if (scheduleError) console.error("Failed to create study schedule:", scheduleError);
    return failure("Could not create the schedule. Try again.");
  }
  const scheduleId = schedule.id;
  const { supabase, userId } = context;

  async function undoPartialCreate() {
    try {
      const { data, error } = await supabase.from("study_schedules")
        .delete().eq("id", scheduleId).eq("user_id", userId)
        .select("id").maybeSingle();
      if (!error && data) {
        return failure("Could not save the whole schedule. Nothing was kept; please try again.");
      }
      console.error("Failed to remove incomplete study schedule:", error ?? scheduleId);
    } catch (error) {
      console.error("Failed to remove incomplete study schedule:", error);
    }
    revalidatePath("/");
    try {
      const { data, error } = await supabase.from("study_schedules")
        .select("id").eq("id", scheduleId).eq("user_id", userId).maybeSingle();
      if (!error && !data) {
        return failure("Could not save the whole schedule. Nothing was kept; please try again.");
      }
      if (!error && data) {
        return {
          error: "The schedule was only partially saved. Open it to review what was saved.",
          scheduleId,
        };
      }
      if (error) console.error("Failed to verify incomplete study schedule:", error);
    } catch (error) {
      console.error("Failed to verify incomplete study schedule:", error);
    }
    return {
      error: "Could not confirm whether the incomplete schedule was removed. Check your dashboard before retrying.",
      scheduleId: null,
    };
  }

  try {
    if (selectedIds.length) {
      const { error } = await supabase.from("study_schedule_cards")
        .insert(selectedIds.map((cardId) => ({ study_schedule_id: scheduleId, card_id: cardId })));
      if (error) {
        console.error("Failed to save schedule cards:", error);
        return undoPartialCreate();
      }
    }
    if (input.reviewDates.length) {
      const { error } = await supabase.from("study_schedule_dates")
        .insert(input.reviewDates.map((date) => ({ study_schedule_id: scheduleId, review_date: date })));
      if (error) {
        console.error("Failed to save schedule dates:", error);
        return undoPartialCreate();
      }
    }
  } catch (error) {
    console.error("Unexpected error while saving schedule cards or dates:", error);
    return undoPartialCreate();
  }

  revalidatePath("/");
  return { error: null, scheduleId };
}
