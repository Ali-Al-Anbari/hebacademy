"use client";

import { useFormStatus } from "react-dom";

export function StartStudyButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-teal-700 px-5 py-2.5 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60 sm:w-auto">
      {pending ? "Starting…" : "Start Study"}
    </button>
  );
}
