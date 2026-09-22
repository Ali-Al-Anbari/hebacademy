"use client";

import { useFormStatus } from "react-dom";

export function StartStudyButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-60">
      {pending ? "Starting…" : "Start Study"}
    </button>
  );
}
