"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function StartQuizButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={disabled || pending}>{pending ? "Starting…" : "Start New Quiz"}</Button>;
}
