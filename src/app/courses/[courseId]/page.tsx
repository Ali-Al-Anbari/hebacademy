import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DeckManager } from "./deck-manager";
import { AppBreadcrumb } from "@/components/app-breadcrumb";

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
      <main className="page-container">
        <Link href="/" className="breadcrumb">← Back to Dashboard</Link>
        <p role="alert" className="notice-error mt-9">Could not load this course. Please refresh and try again.</p>
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
    <main className="page-container">
      <AppBreadcrumb items={[{ label: "Dashboard", href: "/" }]} current={course.name} />

      {decksError ? (
        <>
          <div className="page-intro mt-1">
            <p className="page-eyebrow">Course</p>
            <h1 className="page-title">{course.name}</h1>
            <p className="page-description">Your study decks for this course.</p>
          </div>
          <p role="alert" className="notice-error mt-5">Could not load the decks. Please refresh and try again.</p>
        </>
      ) : (
        <DeckManager courseId={courseId} courseName={course.name} decks={decks ?? []} />
      )}
    </main>
  );
}
