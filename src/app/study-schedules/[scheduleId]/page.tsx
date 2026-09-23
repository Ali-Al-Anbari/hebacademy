import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCalendarDate } from "@/lib/schedules";
import { createClient } from "@/lib/supabase/server";

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
    .select("id, name, description, exam_date, deck_id")
    .eq("id", scheduleId).eq("user_id", userId).maybeSingle();
  if (scheduleError) console.error("Failed to load study schedule:", scheduleError);
  if (!scheduleError && !schedule) notFound();

  const deckResult = schedule && !scheduleError
    ? await supabase.from("decks").select("id, name, course_id")
        .eq("id", schedule.deck_id).eq("user_id", userId).maybeSingle()
    : null;
  if (deckResult?.error) console.error("Failed to load schedule deck:", deckResult.error);
  if (deckResult && !deckResult.error && !deckResult.data) notFound();

  const [courseResult, cardsResult, datesResult] = deckResult?.data
    ? await Promise.all([
        supabase.from("courses").select("id, name")
          .eq("id", deckResult.data.course_id).eq("user_id", userId).maybeSingle(),
        supabase.from("study_schedule_cards").select("card_id", { count: "exact", head: true })
          .eq("study_schedule_id", scheduleId),
        supabase.from("study_schedule_dates").select("id, review_date")
          .eq("study_schedule_id", scheduleId).order("review_date"),
      ])
    : [null, null, null];
  if (courseResult?.error) console.error("Failed to load schedule course:", courseResult.error);
  if (cardsResult?.error) console.error("Failed to count schedule cards:", cardsResult.error);
  if (datesResult?.error) console.error("Failed to load schedule dates:", datesResult.error);
  if (courseResult && !courseResult.error && !courseResult.data) notFound();
  const loadError = scheduleError || deckResult?.error || courseResult?.error
    || cardsResult?.error || datesResult?.error || !schedule || !deckResult?.data || !courseResult?.data;

  return (
    <main className="page-container page-container--narrow">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" }]} current={schedule?.name ?? "Study schedule"} />
      {loadError ? (
        <p role="alert" className="notice-error mt-6">Could not load this schedule. Please refresh and try again.</p>
      ) : (
        <>
          <div className="page-intro mt-2">
            <p className="page-eyebrow">Study schedule</p>
            <h1 className="page-title">{schedule.name}</h1>
            <p className="page-description">{courseResult?.data?.name} · {deckResult?.data?.name}</p>
          </div>
          {schedule.description && <p className="mt-5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{schedule.description}</p>}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Card className="py-0"><CardContent className="p-5"><p className="text-sm text-muted-foreground">Selected cards</p><p className="mt-2 text-xl font-semibold tabular-nums">{cardsResult?.count ?? 0}</p></CardContent></Card>
            <Card className="py-0"><CardContent className="p-5"><p className="text-sm text-muted-foreground">Exam date</p><p className="mt-2 text-base font-semibold">{schedule.exam_date ? formatCalendarDate(schedule.exam_date) : "No exam date"}</p></CardContent></Card>
          </div>
          <section className="mt-8" aria-labelledby="review-dates-title">
            <h2 id="review-dates-title" className="section-title">Review dates</h2>
            {datesResult?.data?.length ? (
              <ul className="mt-3 space-y-2">{datesResult.data.map((date) => <li key={date.id} className="rounded-md border border-border bg-white px-4 py-3 text-sm">{formatCalendarDate(date.review_date)}</li>)}</ul>
            ) : <p className="page-description mt-2">No review dates selected yet.</p>}
          </section>
          <p className="field-hint mt-6">Schedule study and editing will be available in a later stage. Your card selection is saved.</p>
          <Button render={<Link href="/" />} variant="secondary" className="mt-5 w-full sm:w-auto">Back to Dashboard</Button>
        </>
      )}
    </main>
  );
}
