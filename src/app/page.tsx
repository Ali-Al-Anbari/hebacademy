import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CourseManager } from "./course-manager";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const { data: courses, error: coursesError } = await supabase
    .from("courses")
    .select("id, name")
    .eq("user_id", data.claims.sub)
    .order("created_at", { ascending: false });
  if (coursesError) console.error("Failed to load courses:", coursesError);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div>
        <p className="mb-2 text-sm font-medium text-teal-700">Dashboard</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Your Courses</h1>
        <p className="mt-3 text-slate-600">Pick up where you left off and explore your study decks.</p>
      </div>
      {coursesError ? (
        <p role="alert" className="mt-9 rounded-xl border border-red-200 bg-white p-6 text-red-700">Could not load your courses. Please refresh and try again.</p>
      ) : (
        <CourseManager courses={courses ?? []} />
      )}
    </main>
  );
}
