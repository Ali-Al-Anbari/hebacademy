import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DeckManager } from "./deck-manager";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default async function CoursePage({ params }: PageProps<"/courses/[courseId]">) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const { courseId } = await params;
  if (!validId(courseId)) notFound();
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .eq("user_id", data.claims.sub)
    .maybeSingle();

  if (courseError) console.error("Failed to load course:", courseError);
  if (courseError) {
    return (
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <Link href="/" className="inline-flex min-h-11 items-center pr-3 text-sm font-medium text-teal-700 hover:text-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">← Back to Dashboard</Link>
        <p role="alert" className="mt-9 rounded-xl border border-red-200 bg-white p-6 text-red-700">Could not load this course. Please refresh and try again.</p>
      </main>
    );
  }
  if (!course) notFound();

  const { data: decks, error: decksError } = await supabase
    .from("decks")
    .select("id, name, description")
    .eq("course_id", courseId)
    .eq("user_id", data.claims.sub)
    .order("created_at", { ascending: true });
  if (decksError) console.error("Failed to load decks:", decksError);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <nav aria-label="Breadcrumb">
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-lg pr-3 text-sm font-medium text-teal-700 hover:text-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
        <span aria-hidden="true">←</span> Back to Dashboard
      </Link>
      </nav>

      <div className="mt-9 border-b border-slate-200 pb-8">
        <p className="text-sm font-medium text-teal-700">Course</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{course.name}</h1>
        <p className="mt-3 text-slate-600">Your study decks for this course.</p>
      </div>

      {decksError ? (
        <p role="alert" className="mt-9 rounded-xl border border-red-200 bg-white p-6 text-red-700">Could not load the decks. Please refresh and try again.</p>
      ) : (
        <DeckManager courseId={courseId} decks={decks ?? []} />
      )}
    </main>
  );
}
