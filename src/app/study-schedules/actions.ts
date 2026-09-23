"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnedStudyCards } from "@/lib/study-data";
import { getCompletedScheduleDateIds, getScheduleCardIds, getScheduleDates } from "@/lib/schedule-data";
import { isCalendarDate, type ScheduleDraft, type ScheduleEdit } from "@/lib/schedules";
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
  if (input.selectionMode === "manual"
      && new Set(input.manualCardIds).size !== input.manualCardIds.length) {
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
  if (input.selectionMode === "manual" && input.manualCardIds.some((id) => !ownedIds.has(id))) {
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

async function ownedSchedule(scheduleId: string) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;
  if (typeof scheduleId !== "string" || !validId(scheduleId)) return null;

  const { data: schedule, error: scheduleError } = await supabase.from("study_schedules")
    .select("id, deck_id").eq("id", scheduleId).eq("user_id", userId).maybeSingle();
  if (scheduleError) console.error("Failed to verify study schedule:", scheduleError);
  if (scheduleError || !schedule) return null;
  const { data: deck, error: deckError } = await supabase.from("decks")
    .select("id, course_id").eq("id", schedule.deck_id).eq("user_id", userId).maybeSingle();
  if (deckError) console.error("Failed to verify schedule deck:", deckError);
  if (deckError || !deck) return null;
  return { supabase, userId, scheduleId, deckId: deck.id };
}

function refreshSchedule(scheduleId: string) {
  revalidatePath("/");
  revalidatePath(`/study-schedules/${scheduleId}`);
}

export async function updateSchedule(scheduleId: string, input: ScheduleEdit) {
  const failure = (error: string) => ({ error });
  if (!input || typeof input !== "object") return failure("Complete the schedule form first.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!name || name.length > 120) return failure("Enter a schedule name of 1 to 120 characters.");
  if (typeof input.description !== "string" || description.length > 1000) {
    return failure("Keep the description under 1,000 characters.");
  }
  if (typeof input.examDate !== "string" || (input.examDate && !isCalendarDate(input.examDate))) {
    return failure("Enter a valid exam date or leave it blank.");
  }
  if (!["all", "starred", "manual"].includes(input.selectionMode)
      || !Array.isArray(input.manualCardIds)
      || !input.manualCardIds.every((id) => typeof id === "string" && validId(id))
      || (input.selectionMode === "manual"
        && new Set(input.manualCardIds).size !== input.manualCardIds.length)) {
    return failure("Check the selected cards.");
  }
  if (!Array.isArray(input.reviewDates) || !input.reviewDates.every((date) =>
    date && (date.id === null || (typeof date.id === "string" && validId(date.id)))
    && typeof date.review_date === "string" && isCalendarDate(date.review_date))) {
    return failure("Check the review dates.");
  }
  const submittedIds = input.reviewDates.filter((date) => date.id !== null).map((date) => date.id);
  const submittedValues = input.reviewDates.map((date) => date.review_date);
  if (new Set(submittedIds).size !== submittedIds.length
      || new Set(submittedValues).size !== submittedValues.length) {
    return failure("Remove duplicate review dates.");
  }

  const context = await ownedSchedule(scheduleId);
  if (!context) return failure("This schedule is unavailable.");
  let cards: Awaited<ReturnType<typeof getOwnedStudyCards>>;
  let currentCardIds: string[];
  let currentDates: Awaited<ReturnType<typeof getScheduleDates>>;
  let completedDateIds: Set<string>;
  try {
    [cards, currentCardIds, currentDates] = await Promise.all([
      getOwnedStudyCards(context.supabase, context.deckId, context.userId),
      getScheduleCardIds(context.supabase, scheduleId),
      getScheduleDates(context.supabase, scheduleId),
    ]);
    completedDateIds = await getCompletedScheduleDateIds(
      context.supabase, context.userId, currentDates.map((date) => date.id),
    );
  } catch (error) {
    console.error("Failed to load schedule for editing:", error);
    return failure("Could not check the current schedule. Please refresh and try again.");
  }
  const ownedCardIds = new Set(cards.map((card) => card.id));
  if (input.selectionMode === "manual" && input.manualCardIds.some((id) => !ownedCardIds.has(id))) {
    return failure("One or more selected cards are no longer in this deck.");
  }
  const desiredCardIds = input.selectionMode === "all"
    ? cards.map((card) => card.id)
    : input.selectionMode === "starred"
      ? cards.filter((card) => card.is_starred).map((card) => card.id)
      : input.manualCardIds;
  const existingDates = new Map(currentDates.map((date) => [date.id, date]));
  const submittedById = new Map(input.reviewDates.filter((date) => date.id !== null)
    .map((date) => [date.id, date.review_date]));
  if (submittedIds.some((id) => !existingDates.has(id!))) {
    return failure("A review date changed elsewhere. Refresh and try again.");
  }
  for (const date of currentDates) {
    if (completedDateIds.has(date.id) && submittedById.get(date.id) !== date.review_date) {
      return failure("Completed review dates cannot be changed or removed. Refresh the schedule.");
    }
  }

  const currentCardSet = new Set(currentCardIds);
  const desiredCardSet = new Set(desiredCardIds);
  const cardsToAdd = desiredCardIds.filter((id) => !currentCardSet.has(id));
  const cardsToRemove = currentCardIds.filter((id) => !desiredCardSet.has(id));
  const newDateValues = new Set(input.reviewDates.filter((date) => date.id === null)
    .map((date) => date.review_date));
  const datesToDelete = currentDates.filter((date) =>
    !submittedById.has(date.id) && !newDateValues.has(date.review_date));
  const datesToUpdate = currentDates.filter((date) =>
    submittedById.has(date.id) && submittedById.get(date.id) !== date.review_date);
  const keptDateValues = new Set(currentDates.filter((date) =>
    submittedById.get(date.id) === date.review_date
    || (!submittedById.has(date.id) && newDateValues.has(date.review_date)))
    .map((date) => date.review_date));
  const datesToAdd = input.reviewDates.filter((date) =>
    date.id === null && !keptDateValues.has(date.review_date));
  if (datesToUpdate.some((date) => currentDates.some((other) =>
    other.id !== date.id && other.review_date === submittedById.get(date.id)
    && !datesToDelete.some((removed) => removed.id === other.id)))) {
    return failure("Change overlapping review dates one at a time, then save again.");
  }

  const partialFailure = (message: string) => {
    refreshSchedule(scheduleId);
    return failure(`${message} Some changes may have saved. Your form is still here; review it and retry.`);
  };
  const { data: savedSchedule, error: metadataError } = await context.supabase
    .from("study_schedules")
    .update({ name, description: description || null, exam_date: input.examDate || null,
      updated_at: new Date().toISOString() })
    .eq("id", scheduleId).eq("user_id", context.userId).select("id").maybeSingle();
  if (metadataError || !savedSchedule) {
    if (metadataError) console.error("Failed to update schedule details:", metadataError);
    return failure("Could not confirm the schedule details were saved. Refresh and review before retrying.");
  }

  try {
    if (cardsToAdd.length) {
      const { error } = await context.supabase.from("study_schedule_cards")
        .insert(cardsToAdd.map((cardId) => ({ study_schedule_id: scheduleId, card_id: cardId })));
      if (error) throw error;
    }
    for (let offset = 0; offset < cardsToRemove.length; offset += 100) {
      const { error } = await context.supabase.from("study_schedule_cards")
        .delete().eq("study_schedule_id", scheduleId)
        .in("card_id", cardsToRemove.slice(offset, offset + 100));
      if (error) throw error;
    }
    for (let offset = 0; offset < datesToDelete.length; offset += 100) {
      const { error } = await context.supabase.from("study_schedule_dates")
        .delete().eq("study_schedule_id", scheduleId)
        .in("id", datesToDelete.slice(offset, offset + 100).map((date) => date.id));
      if (error) throw error;
    }
    for (const date of datesToUpdate) {
      const { data, error } = await context.supabase.from("study_schedule_dates")
        .update({ review_date: submittedById.get(date.id)! })
        .eq("id", date.id).eq("study_schedule_id", scheduleId)
        .select("id").maybeSingle();
      if (error || !data) throw error ?? new Error("Schedule date disappeared while saving");
    }
    if (datesToAdd.length) {
      const { error } = await context.supabase.from("study_schedule_dates")
        .insert(datesToAdd.map((date) => ({ study_schedule_id: scheduleId,
          review_date: date.review_date })));
      if (error) throw error;
    }
    const [savedCards, savedDates] = await Promise.all([
      getScheduleCardIds(context.supabase, scheduleId),
      getScheduleDates(context.supabase, scheduleId),
    ]);
    if (savedCards.length !== desiredCardSet.size
        || savedCards.some((id) => !desiredCardSet.has(id))
        || savedDates.length !== submittedValues.length
        || savedDates.some((date) => !submittedValues.includes(date.review_date))) {
      return partialFailure("The saved schedule did not match your edits.");
    }
  } catch (error) {
    console.error("Failed to save schedule cards or dates:", error);
    if (typeof error === "object" && error && "code" in error && error.code === "23514") {
      return partialFailure("A review date was completed while you were editing it.");
    }
    return partialFailure("Could not save all schedule changes.");
  }

  refreshSchedule(scheduleId);
  return { error: null };
}

export async function setScheduleArchived(scheduleId: string, archived: boolean) {
  if (typeof archived !== "boolean") return { error: "Could not change the schedule status." };
  const context = await ownedSchedule(scheduleId);
  if (!context) return { error: "This schedule is unavailable." };
  const { data, error } = await context.supabase.from("study_schedules")
    .update({ archived_at: archived ? new Date().toISOString() : null,
      updated_at: new Date().toISOString() })
    .eq("id", scheduleId).eq("user_id", context.userId).select("id").maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to archive schedule:", error);
    return { error: "Could not change the schedule status. Please try again." };
  }
  refreshSchedule(scheduleId);
  return { error: null };
}

export async function deleteSchedule(scheduleId: string) {
  const context = await ownedSchedule(scheduleId);
  if (!context) return { error: "This schedule is unavailable." };
  const { data, error } = await context.supabase.from("study_schedules")
    .delete().eq("id", scheduleId).eq("user_id", context.userId)
    .select("id").maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to delete schedule:", error);
    return { error: "Could not delete the schedule. Please try again." };
  }
  refreshSchedule(scheduleId);
  return { error: null };
}
