"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseCardImport, validateImportCards, type ImportRow, MAX_IMPORT_CARDS } from "@/lib/cards/import";
import { importCards } from "./import-actions";

export function ImportCards({ courseId, deckId }: { courseId: string; deckId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [previewCards, setPreviewCards] = useState<ImportRow[] | null>(null);
  const [previewEdited, setPreviewEdited] = useState(false);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [pending, setPending] = useState(false);
  const submissionInProgress = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const preview = previewCards === null ? null : validateImportCards(previewCards);

  function resetForm() {
    setSource("");
    setPreviewCards(null);
    setPreviewEdited(false);
    setSourceChanged(false);
    setConfirmReplace(false);
    setError("");
  }

  function updateSource(value: string) {
    setSource(value);
    if (previewCards !== null) setSourceChanged(true);
    setConfirmReplace(false);
    setError("");
    setResult(null);
  }

  function regeneratePreview() {
    setPreviewCards(parseCardImport(source));
    setPreviewEdited(false);
    setSourceChanged(false);
    setConfirmReplace(false);
    setError("");
    setResult(null);
  }

  function showPreview() {
    if (previewCards !== null && previewEdited) setConfirmReplace(true);
    else regeneratePreview();
  }

  function editPreviewCard(line: number, field: "prompt" | "answer", value: string) {
    setPreviewCards((cards) => cards?.map((card) => card.line === line ? { ...card, [field]: value } : card) ?? null);
    setPreviewEdited(true);
    setConfirmReplace(false);
    setError("");
    setResult(null);
  }

  function removePreviewCard(line: number) {
    setPreviewCards((cards) => cards?.filter((card) => card.line !== line) ?? null);
    setPreviewEdited(true);
    setConfirmReplace(false);
    setError("");
    setResult(null);
  }

  async function submit() {
    if (!preview || !previewCards || sourceChanged || preview.errorCount || preview.limitExceeded || !preview.candidates.length || submissionInProgress.current) return;
    submissionInProgress.current = true;
    setPending(true);
    setError("");
    try {
      const response = await importCards(courseId, deckId, previewCards.map(({ prompt, answer }) => ({ prompt, answer })));
      if (response.error) setError(response.error);
      else {
        setResult({ inserted: response.inserted, skipped: response.skipped });
        setOpen(false);
        resetForm();
        router.refresh();
      }
    } catch {
      setError("Could not import cards. Please try again.");
    } finally {
      submissionInProgress.current = false;
      setPending(false);
    }
  }

  return <>
    <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => { setResult(null); setOpen(true); }}><Upload /> Import Cards</Button>
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) setOpen(nextOpen); }}>
      <DialogContent className="max-h-[min(90dvh,900px)] w-[calc(100%-1.5rem)] max-w-3xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import cards</DialogTitle>
          <DialogDescription>Start each card with one question line, then put the answer on the following line or lines. Leave a blank line between cards. Preview and edit up to {MAX_IMPORT_CARDS} cards.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="card-import-source">Questions and answers</Label>
          <Textarea id="card-import-source" value={source} onChange={(event) => updateSource(event.target.value)} disabled={pending} rows={8} className="min-h-40 font-mono text-sm" placeholder={"What does the cornea do?\nIt refracts incoming light.\n- It protects the eye.\n\nWhat does the retina do?\nIt converts light into neural signals."} aria-describedby="card-import-help" />
          <p id="card-import-help" className="text-xs text-muted-foreground">Blank lines separate cards, so answers cannot contain blank lines yet. Line breaks within an answer are kept. Matching question and answer pairs are compared without case or extra whitespace.</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Close</Button>
          <Button type="button" variant="secondary" disabled={pending || !source.trim()} onClick={showPreview}>Preview cards</Button>
        </div>

        {sourceChanged && previewCards !== null && <p role="status" className="rounded-md bg-secondary px-4 py-3 text-sm">The pasted text changed. This preview is stale. Preview again before importing; your current edits remain here until you regenerate.</p>}
        {confirmReplace && <div className="space-y-3 rounded-md border border-border bg-muted/50 p-4 text-sm" role="alert">
          <p>Regenerating the preview will discard your edits and removed cards. Your pasted text will stay unchanged.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmReplace(false)}>Keep edited preview</Button>
            <Button type="button" disabled={pending} onClick={regeneratePreview}>Discard edits and regenerate</Button>
          </div>
        </div>}

        {preview && previewCards && <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span>{preview.candidates.length} valid unique {preview.candidates.length === 1 ? "card" : "cards"}</span>
            <span>{preview.duplicateCount} duplicate {preview.duplicateCount === 1 ? "pair" : "pairs"} to skip</span>
            <span>{preview.errorCount} invalid {preview.errorCount === 1 ? "card" : "cards"}</span>
          </div>
          {preview.limitExceeded && <p role="alert" className="notice-error text-sm">The final preview has more than {MAX_IMPORT_CARDS} valid unique cards. Remove some cards before importing.</p>}
          {preview.errorCount > 0 && <p role="alert" className="notice-error text-sm">Correct or remove every invalid card in the preview before importing.</p>}
          {previewCards.length === 0 && <p className="rounded-md bg-muted px-4 py-5 text-sm text-muted-foreground">No cards remain in the preview. Edit the pasted text and preview it again to add cards.</p>}
          {previewCards.length > 0 && <div className="max-h-[40dvh] space-y-3 overflow-y-auto pr-1" role="region" aria-label="Editable card import preview" tabIndex={0}>
            {previewCards.map((card: ImportRow, index) => {
              const status = preview.rows[index];
              return <div key={card.line} className="space-y-3 rounded-md border border-border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Card {index + 1} <span className="font-normal text-muted-foreground">· source {card.line === card.endLine ? `line ${card.line}` : `lines ${card.line}–${card.endLine}`}</span></p>
                  <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => removePreviewCard(card.line)} aria-label={`Remove preview card ${index + 1}`}><Trash2 /> Remove</Button>
                </div>
                <div className="space-y-1.5"><Label htmlFor={`import-question-${card.line}`}>Question</Label><Input id={`import-question-${card.line}`} value={card.prompt} onChange={(event) => editPreviewCard(card.line, "prompt", event.target.value)} disabled={pending} aria-invalid={Boolean(status.error) && (!status.prompt || status.prompt.length > 5000)} /></div>
                <div className="space-y-1.5"><Label htmlFor={`import-answer-${card.line}`}>Answer</Label><Textarea id={`import-answer-${card.line}`} value={card.answer} onChange={(event) => editPreviewCard(card.line, "answer", event.target.value)} disabled={pending} rows={4} aria-invalid={Boolean(status.error) && (!status.answer || status.answer.length > 5000 || /\n[^\S\n]*\n/u.test(status.answer))} /></div>
                <p role={status.error ? "alert" : "status"} className={`text-xs ${status.error ? "text-destructive" : "text-muted-foreground"}`}>{status.error ?? (status.duplicateOf !== null ? `Duplicate of preview card ${status.duplicateOf}; skipped on import.` : "Ready to import")}</p>
              </div>;
            })}
          </div>}
          <p className="text-xs text-muted-foreground">Existing deck duplicates are checked again on the server when you import.</p>
          <Button type="button" className="w-full sm:w-auto" disabled={pending || sourceChanged || Boolean(result) || preview.errorCount > 0 || preview.limitExceeded || preview.candidates.length === 0} onClick={() => void submit()}>{pending ? "Importing…" : `Import ${preview.candidates.length} ${preview.candidates.length === 1 ? "card" : "cards"}`}</Button>
        </div>}
        {error && <p role="alert" className="notice-error text-sm">{error}</p>}
      </DialogContent>
    </Dialog>
    {result && <p role="status" className="mt-3 rounded-md bg-secondary px-4 py-3 text-sm">Imported {result.inserted} {result.inserted === 1 ? "card" : "cards"}; skipped {result.skipped} {result.skipped === 1 ? "duplicate" : "duplicates"}. The deck has been refreshed.</p>}
  </>;
}
