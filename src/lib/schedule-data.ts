import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function getScheduleCardIds(supabase: SupabaseClient, scheduleId: string) {
  const ids: string[] = [];
  const pageSize = 1000;
  for (let offset = 0; ;) {
    const { data, count, error } = await supabase.from("study_schedule_cards")
      .select("card_id", { count: "exact" })
      .eq("study_schedule_id", scheduleId)
      .order("card_id")
      .range(offset, offset + pageSize - 1);
    if (error || count === null) throw error ?? new Error("Missing schedule card count");
    ids.push(...(data ?? []).map((row) => row.card_id));
    if (offset + (data?.length ?? 0) >= count) break;
    if (!data?.length) throw new Error("Schedule card query stopped early");
    offset += data.length;
  }
  return ids;
}

export async function getScheduleDates(supabase: SupabaseClient, scheduleId: string) {
  const dates: { id: string; review_date: string }[] = [];
  const pageSize = 1000;
  for (let offset = 0; ;) {
    const { data, count, error } = await supabase.from("study_schedule_dates")
      .select("id, review_date", { count: "exact" })
      .eq("study_schedule_id", scheduleId)
      .order("review_date").order("id")
      .range(offset, offset + pageSize - 1);
    if (error || count === null) throw error ?? new Error("Missing schedule date count");
    dates.push(...(data ?? []));
    if (offset + (data?.length ?? 0) >= count) break;
    if (!data?.length) throw new Error("Schedule date query stopped early");
    offset += data.length;
  }
  return dates;
}

export async function getCompletedScheduleDateIds(
  supabase: SupabaseClient, userId: string, dateIds: string[],
) {
  const completed = new Set<string>();
  for (let offset = 0; offset < dateIds.length; offset += 100) {
    const { data, error } = await supabase.from("study_sessions")
      .select("study_schedule_date_id")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .in("study_schedule_date_id", dateIds.slice(offset, offset + 100));
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.study_schedule_date_id) completed.add(row.study_schedule_date_id);
    }
  }
  return completed;
}
