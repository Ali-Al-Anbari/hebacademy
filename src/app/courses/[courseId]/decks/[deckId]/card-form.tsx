"use client";

import { useState, type FormEvent } from "react";

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
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <label htmlFor={initial ? "edit-card-prompt" : "new-card-prompt"} className="block text-sm font-medium text-slate-700">Prompt</label>
        <textarea id={initial ? "edit-card-prompt" : "new-card-prompt"} value={prompt} onChange={(event) => setPrompt(event.target.value)} required maxLength={5000} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
      </div>
      <div>
        <label htmlFor={initial ? "edit-card-answer" : "new-card-answer"} className="block text-sm font-medium text-slate-700">Answer</label>
        <textarea id={initial ? "edit-card-answer" : "new-card-answer"} value={answer} onChange={(event) => setAnswer(event.target.value)} required maxLength={5000} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={initial ? "edit-prompt-image" : "new-prompt-image"} className="block text-sm font-medium text-slate-700">Prompt image (optional)</label>
          <input id={initial ? "edit-prompt-image" : "new-prompt-image"} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setPromptFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-teal-800" />
          {initial?.hasPromptImage && <label className="mt-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={removePromptImage} onChange={(event) => setRemovePromptImage(event.target.checked)} />Remove existing image</label>}
        </div>
        <div>
          <label htmlFor={initial ? "edit-answer-image" : "new-answer-image"} className="block text-sm font-medium text-slate-700">Answer image (optional)</label>
          <input id={initial ? "edit-answer-image" : "new-answer-image"} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setAnswerFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-teal-800" />
          {initial?.hasAnswerImage && <label className="mt-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={removeAnswerImage} onChange={(event) => setRemoveAnswerImage(event.target.checked)} />Remove existing image</label>}
        </div>
      </div>
      {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60">{busy ? "Saving…" : "Save card"}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
      </div>
    </form>
  );
}
