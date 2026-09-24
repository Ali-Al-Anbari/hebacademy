import { notFound, redirect } from "next/navigation";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { getCompletedScheduleDateIds, getScheduleCardIds, getScheduleDates, getUnfinishedScheduleDateIds } from "@/lib/schedule-data";
import { getOwnedStudyCards } from "@/lib/study-data";
import { createClient } from "@/lib/supabase/server";
import { ScheduleManager } from "./schedule-manager";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default async function SchedulePage({ params }: PageProps<"/study-schedules/[scheduleId]">) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;
  const { scheduleId } = await params;
  if (!validId(scheduleId)) notFound();

  const { data: schedule, error: scheduleError } = await supabase.from("study_schedules")
    .select("id, name, description, exam_date, archived_at, deck_id")
    .eq("id", scheduleId).eq("user_id", userId).maybeSingle();
  if (scheduleError) console.error("Failed to load study schedule:", scheduleError);
  if (!scheduleError && !schedule) notFound();

  const deckResult = schedule && !scheduleError
    ? await supabase.from("decks").select("id, name, course_id")
        .eq("id", schedule.deck_id).eq("user_id", userId).maybeSingle()
    : null;
  if (deckResult?.error) console.error("Failed to load schedule deck:", deckResult.error);
  if (deckResult && !deckResult.error && !deckResult.data) notFound();

  const courseResult = deckResult?.data
    ? await supabase.from("courses").select("id, name")
        .eq("id", deckResult.data.course_id).eq("user_id", userId).maybeSingle()
    : null;
  if (courseResult?.error) console.error("Failed to load schedule course:", courseResult.error);
  if (courseResult && !courseResult.error && !courseResult.data) notFound();

  let cards: Awaited<ReturnType<typeof getOwnedStudyCards>> = [];
  let selectedIds: string[] = [];
  let dates: Awaited<ReturnType<typeof getScheduleDates>> = [];
  let completedIds = new Set<string>();
  let unfinishedIds = new Set<string>();
  let resumeAnytime = false;
  let dataError = false;
  if (schedule && deckResult?.data && courseResult?.data) {
    try {
      [cards, selectedIds, dates] = await Promise.all([
        getOwnedStudyCards(supabase, deckResult.data.id, userId),
        getScheduleCardIds(supabase, scheduleId),
        getScheduleDates(supabase, scheduleId),
      ]);
      [completedIds, unfinishedIds] = await Promise.all([
        getCompletedScheduleDateIds(supabase, userId, dates.map((date) => date.id)),
        getUnfinishedScheduleDateIds(supabase, userId, dates.map((date) => date.id),
          new Set(cards.map((card) => card.id))),
      ]);
      const { data: anytime, error: anytimeError } = await supabase.from("study_sessions")
        .select("selected_card_ids").eq("user_id", userId).eq("deck_id", deckResult.data.id)
        .eq("study_schedule_id", scheduleId).is("study_schedule_date_id", null)
        .is("completed_at", null).order("started_at", { ascending: false })
        .limit(100);
      if (anytimeError) throw anytimeError;
      const ownedCardIds = new Set(cards.map((card) => card.id));
      resumeAnytime = Boolean(anytime?.some((session) => {
        const ids = session.selected_card_ids as string[] | null;
        return ids?.length && new Set(ids).size === ids.length
          && ids.every((id) => ownedCardIds.has(id));
      }));
    } catch (error) {
      console.error("Failed to load schedule cards or dates:", error);
      dataError = true;
    }
  }

  const hasError = scheduleError || deckResult?.error || courseResult?.error || dataError
    || !schedule || !deckResult?.data || !courseResult?.data;

  return (
    <main className="page-container page-container--narrow">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" }]} current={schedule?.name ?? "Study schedule"} />
      {hasError ? (
        <p role="alert" className="notice-error mt-6">Could not load this schedule. Please refresh and try again.</p>
      ) : (
        <ScheduleManager
          schedule={{ id: schedule.id, name: schedule.name, description: schedule.description,
            examDate: schedule.exam_date, archived: Boolean(schedule.archived_at) }}
          courseName={courseResult?.data?.name ?? "Course"}
          deckName={deckResult?.data?.name ?? "Deck"}
          cards={cards.map(({ id, prompt, is_starred }) => ({ id, prompt, is_starred }))}
          selectedCardIds={selectedIds}
          resumeAnytime={resumeAnytime}
          dates={dates.map((date) => ({ ...date, completed: completedIds.has(date.id), resumable: unfinishedIds.has(date.id) }))}
        />
      )}
    </main>
  );
}
