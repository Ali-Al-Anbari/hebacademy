import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { ScheduleForm } from "./schedule-form";

export default async function NewSchedulePage() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const userId = auth.claims.sub;

  const [coursesResult, decksResult] = await Promise.all([
    supabase.from("courses").select("id, name")
      .eq("user_id", userId).order("name"),
    supabase.from("decks").select("id, name, course_id")
      .eq("user_id", userId).order("name"),
  ]);
  if (coursesResult.error) console.error("Failed to load schedule courses:", coursesResult.error);
  if (decksResult.error) console.error("Failed to load schedule decks:", decksResult.error);

  return (
    <main className="page-container page-container--narrow">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" }]} current="Create schedule" />
      <div className="page-intro mt-2">
        <h1 className="page-title">Create a study schedule</h1>
        <p className="page-description">Choose a deck, save its cards, and pick the days you want to review.</p>
      </div>
      {coursesResult.error || decksResult.error ? (
        <p role="alert" className="notice-error mt-6">Could not load your courses and decks. Please refresh and try again.</p>
      ) : !coursesResult.data?.length ? (
        <div className="empty-panel mt-6">
          <h2 className="empty-panel__title">Create a course first</h2>
          <p className="empty-panel__copy">Schedules use cards from one of your existing decks.</p>
          <Button render={<Link href="/" />} className="mt-5">Back to Dashboard</Button>
        </div>
      ) : (
        <ScheduleForm courses={coursesResult.data} decks={decksResult.data ?? []} />
      )}
    </main>
  );
}
