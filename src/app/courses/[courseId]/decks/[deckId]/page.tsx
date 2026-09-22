import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default async function DeckPage({
  params,
}: PageProps<"/courses/[courseId]/decks/[deckId]">) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const { courseId, deckId } = await params;
  if (!validId(courseId) || !validId(deckId)) notFound();

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .eq("user_id", data.claims.sub)
    .maybeSingle();
  if (courseError) console.error("Failed to load deck course:", courseError);
  if (!courseError && !course) notFound();

  const deckResult = course
    ? await supabase
        .from("decks")
        .select("id, name, description")
        .eq("id", deckId)
        .eq("course_id", courseId)
        .eq("user_id", data.claims.sub)
        .maybeSingle()
    : null;
  if (deckResult?.error) console.error("Failed to load deck:", deckResult.error);
  if (course && deckResult && !deckResult.error && !deckResult.data) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <Link href={`/courses/${courseId}`} className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-900 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">← Back to Course</Link>
      {courseError || deckResult?.error ? (
        <p role="alert" className="mt-9 rounded-xl border border-red-200 bg-white p-6 text-red-700">Could not load this deck. Please refresh and try again.</p>
      ) : (
        <>
          <div className="mt-9 border-b border-slate-200 pb-8">
            <p className="text-sm font-medium text-teal-700">{course?.name}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{deckResult?.data?.name}</h1>
            {deckResult?.data?.description && <p className="mt-3 whitespace-pre-wrap text-slate-600">{deckResult.data.description}</p>}
          </div>
          <p className="mt-9 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-slate-600">Cards are coming soon.</p>
        </>
      )}
    </main>
  );
}
