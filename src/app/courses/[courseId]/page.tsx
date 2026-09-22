import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { courses } from "../../sample-courses";

export default async function CoursePage({ params }: PageProps<"/courses/[courseId]">) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/login");

  const { courseId } = await params;
  const course = courses.find((item) => item.id === courseId);

  if (!course) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-900 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
        <span aria-hidden="true">←</span> Back to Dashboard
      </Link>

      <div className="mt-9 border-b border-slate-200 pb-8">
        <p className="text-sm font-medium text-teal-700">Course</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{course.name}</h1>
        <p className="mt-3 text-slate-600">Your study decks for this course.</p>
      </div>

      <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Decks</h2>
          <p className="mt-1 text-sm text-slate-500">{course.decks.length} decks in this course</p>
        </div>
        <button type="button" disabled title="Adding decks is coming soon" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 font-medium text-white opacity-75">
          <span aria-hidden="true" className="text-xl leading-none">+</span>
          Add Deck
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {course.decks.map((deck, index) => (
          <div key={deck} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex size-10 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-600" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{deck}</h3>
            <p className="mt-1 text-sm text-slate-500">Study deck</p>
          </div>
        ))}
      </div>
    </main>
  );
}
