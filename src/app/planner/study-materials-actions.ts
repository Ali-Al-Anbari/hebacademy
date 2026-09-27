"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDateOnly } from "@/lib/planner/dates";
import { createClient } from "@/lib/supabase/server";

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function ownedAssignment(id: string) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  if (!isId(id)) return null;
  const userId = auth.claims.sub;
  const { data, error } = await supabase.from("planner_assignments")
    .select("id, parent_series_id, recurrence_kind")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) console.error("Could not verify Planner assignment:", error);
  return data && !error ? { supabase, userId, assignment: data } : null;
}

function refresh() {
  revalidatePath("/planner");
  revalidatePath("/");
}

export async function saveAssignmentDeckLinks(input: {
  assignmentId: string;
  occurrenceDate: string | null;
  scope: "this" | "future" | "series";
  deckIds: string[];
}) {
  const failure = (error: string) => ({ error, assignmentId: null as string | null });
  if (!input || !Array.isArray(input.deckIds) || !["this", "future", "series"].includes(input.scope)
      || (input.occurrenceDate !== null && !isDateOnly(input.occurrenceDate))
      || input.deckIds.some((id) => !isId(id))
      || new Set(input.deckIds).size !== input.deckIds.length) {
    return failure("Check the selected decks and try again.");
  }
  const context = await ownedAssignment(input.assignmentId);
  if (!context) return failure("This assignment is unavailable.");
  if (input.scope === "future" && !input.occurrenceDate) return failure("Choose a recurring occurrence first.");
  const { data: ownedDecks, error: deckError } = input.deckIds.length
    ? await context.supabase.from("decks").select("id")
      .eq("user_id", context.userId).in("id", input.deckIds)
    : { data: [], error: null };
  if (deckError || ownedDecks?.length !== input.deckIds.length) {
    if (deckError) console.error("Could not verify Planner deck links:", deckError);
    return failure("One or more decks are unavailable.");
  }
  const { data, error } = await context.supabase.rpc("save_planner_assignment_decks", {
    p_assignment_id: input.assignmentId,
    p_original_due_date: input.occurrenceDate,
    p_scope: input.scope,
    p_deck_ids: input.deckIds,
  });
  if (error) {
    console.error("Could not save Planner deck links:", error);
    if (error.code === "23514") return failure("Unlink this deck's study schedule before removing the deck.");
    return failure("Could not save deck links. Please refresh and try again.");
  }
  refresh();
  return { error: null, assignmentId: data as string };
}

export async function unlinkAssignmentStudySchedule(input: {
  assignmentId: string;
  occurrenceDate: string | null;
  scheduleId: string;
}) {
  const failure = (error: string) => ({ error, assignmentId: null as string | null });
  if (!input || !isId(input.scheduleId)
      || (input.occurrenceDate !== null && !isDateOnly(input.occurrenceDate))) {
    return failure("This study schedule link is unavailable.");
  }
  const context = await ownedAssignment(input.assignmentId);
  if (!context) return failure("This assignment is unavailable.");
  const { data: schedule, error: scheduleError } = await context.supabase
    .from("study_schedules").select("id")
    .eq("id", input.scheduleId).eq("user_id", context.userId).maybeSingle();
  if (scheduleError || !schedule) return failure("This study schedule is unavailable.");
  const { data, error } = await context.supabase.rpc("unlink_planner_study_schedule", {
    p_assignment_id: input.assignmentId,
    p_original_due_date: input.occurrenceDate,
    p_study_schedule_id: input.scheduleId,
  });
  if (error) {
    console.error("Could not unlink Planner study schedule:", error);
    return failure("Could not unlink the study schedule. Please refresh and try again.");
  }
  refresh();
  return { error: null, assignmentId: data as string };
}
