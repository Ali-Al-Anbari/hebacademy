"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CardFormValues = {
  prompt: string;
  answer: string;
  promptFile: File | null;
  answerFile: File | null;
  removePromptImage: boolean;
  removeAnswerImage: boolean;
};

export function CardForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { prompt: string; answer: string; hasPromptImage: boolean; hasAnswerImage: boolean };
  onSave: (values: CardFormValues) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [promptFile, setPromptFile] = useState<File | null>(null);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [removePromptImage, setRemovePromptImage] = useState(false);
  const [removeAnswerImage, setRemoveAnswerImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!prompt.trim() || !answer.trim()) {
      setMessage("Enter both a prompt and an answer.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const error = await onSave({ prompt, answer, promptFile, answerFile, removePromptImage, removeAnswerImage });
      if (error) setMessage(error);
    } catch {
      setMessage("Could not save the card. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <Label htmlFor={initial ? "edit-card-prompt" : "new-card-prompt"}>Prompt</Label>
        <Textarea id={initial ? "edit-card-prompt" : "new-card-prompt"} value={prompt} onChange={(event) => setPrompt(event.target.value)} required maxLength={5000} rows={4} placeholder="Write the question or cue…" className="mt-2" />
      </div>
      <div>
        <Label htmlFor={initial ? "edit-card-answer" : "new-card-answer"}>Answer</Label>
        <Textarea id={initial ? "edit-card-answer" : "new-card-answer"} value={answer} onChange={(event) => setAnswer(event.target.value)} required maxLength={5000} rows={4} placeholder="Write the answer…" className="mt-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={initial ? "edit-prompt-image" : "new-prompt-image"}>Prompt image <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={initial ? "edit-prompt-image" : "new-prompt-image"} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setPromptFile(event.target.files?.[0] ?? null)} className="mt-2 cursor-pointer py-1.5" />
          {initial?.hasPromptImage && <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={removePromptImage} onChange={(event) => setRemovePromptImage(event.target.checked)} />Remove existing image</label>}
        </div>
        <div>
          <Label htmlFor={initial ? "edit-answer-image" : "new-answer-image"}>Answer image <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={initial ? "edit-answer-image" : "new-answer-image"} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setAnswerFile(event.target.files?.[0] ?? null)} className="mt-2 cursor-pointer py-1.5" />
          {initial?.hasAnswerImage && <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={removeAnswerImage} onChange={(event) => setRemoveAnswerImage(event.target.checked)} />Remove existing image</label>}
        </div>
      </div>
      {message && <p role="alert" className="notice-error text-sm">{message}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : initial ? "Save changes" : "Create card"}</Button>
      </div>
    </form>
  );
}
