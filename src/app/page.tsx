import Link from "next/link";
import { courses } from "./sample-courses";

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-sm font-medium text-teal-700">Dashboard</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Your Courses</h1>
          <p className="mt-3 text-slate-600">Pick up where you left off and explore your study decks.</p>
        </div>
        <button type="button" disabled title="Adding courses is coming soon" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 font-medium text-white opacity-75">
          <span aria-hidden="true" className="text-xl leading-none">+</span>
          Add Course
        </button>
      </div>

      <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <Link
            key={course.id}
            href={`/courses/${course.id}`}
            className="group flex min-h-48 flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-teal-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            <div>
              <div className="mb-5 flex size-10 items-center justify-center rounded-lg bg-teal-50 text-lg font-semibold text-teal-700" aria-hidden="true">
                {course.name.charAt(0)}
              </div>
              <h2 className="text-xl font-semibold text-slate-900 group-hover:text-teal-800">{course.name}</h2>
            </div>
            <div className="mt-5 flex items-center justify-between text-sm text-slate-500">
              <span>{course.decks.length} decks</span>
              <span aria-hidden="true" className="text-lg text-teal-700">→</span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
