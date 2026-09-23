"use client";

import { useFormStatus } from "react-dom";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StartStudyButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg" className="w-full sm:w-auto"><Play className="fill-current" />{pending ? "Starting…" : "Flashcards"}</Button>
  );
}
