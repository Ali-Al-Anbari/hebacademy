import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CourseManager } from "./course-manager";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const { data: courses, error: coursesError } = await supabase
    .from("courses")
    .select("id, name, decks(count)")
    .eq("user_id", data.claims.sub)
    .order("created_at", { ascending: false });
  if (coursesError) console.error("Failed to load courses:", coursesError);

  return (
    <main className="page-container">
      {coursesError ? (
        <>
          <div className="page-intro">
            <p className="page-eyebrow">Your workspace</p>
            <h1 className="page-title">Your Courses</h1>
            <p className="page-description">Pick up where you left off and explore your study decks.</p>
          </div>
          <p role="alert" className="notice-error mt-5">Could not load your courses. Please refresh and try again.</p>
        </>
      ) : (
        <CourseManager courses={(courses ?? []).map((course) => ({
          id: course.id,
          name: course.name,
          deckCount: course.decks[0]?.count ?? 0,
        }))} />
      )}
    </main>
  );
}
