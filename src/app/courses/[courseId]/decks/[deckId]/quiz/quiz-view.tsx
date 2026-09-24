"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { QuizProgress, QuizQuestion } from "@/lib/quiz-session";
import { nextQuizQuestion, submitQuizAnswer } from "./actions";

type DisplayQuestion = QuizQuestion & { promptImageUrl: string | null };

export function QuizView({ courseId, deckId, sessionId, questions, answers: initialAnswers,
  initialIndex, initialRevision, completed, deckUrl }: {
  courseId: string; deckId: string; sessionId: string;
  questions: DisplayQuestion[]; answers: string[];
  initialIndex: number; initialRevision: number; completed: boolean; deckUrl: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState(initialAnswers);
  const [index, setIndex] = useState(initialIndex);
  const [revision, setRevision] = useState(initialRevision);
  const [isComplete, setIsComplete] = useState(completed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function apply(progress: QuizProgress) {
    setAnswers(progress.answers);
    setIndex(progress.current_index);
    setRevision(progress.revision);
    setIsComplete(Boolean(progress.completed_at));
  }

  async function choose(key: string) {
    if (busy || answers.length > index || isComplete) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await submitQuizAnswer(courseId, deckId, sessionId, revision, key);
      if (result.error || !result.progress) {
        setMessage(result.error ?? "Could not save this answer.");
        if (result.conflict) router.refresh();
      } else apply(result.progress);
    } catch {
      setMessage("Could not save this answer. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (busy || answers.length !== index + 1) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await nextQuizQuestion(courseId, deckId, sessionId, revision);
      if (result.error || !result.progress) {
        setMessage(result.error ?? "Could not continue this quiz.");
        if (result.conflict) router.refresh();
      } else apply(result.progress);
    } catch {
      setMessage("Could not continue this quiz. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const exit = busy
    ? <span aria-disabled="true" className={buttonVariants({ variant: "secondary", className: "opacity-50" })}>Saving…</span>
    : <Link href={deckUrl} className={buttonVariants({ variant: "secondary" })}>Exit</Link>;
  if (isComplete) {
    const missed = questions.flatMap((question, questionIndex) => {
      const chosenKey = answers[questionIndex];
      if (!chosenKey || chosenKey === question.correctKey) return [];
      return [{ question, chosenAnswer: question.options.find((option) => option.key === chosenKey)?.label ?? "" }];
    });
    const correct = questions.length - missed.length;
    return (
      <section className="study-surface mt-5">
        <p className="page-eyebrow">Quiz complete</p>
        <div className="mt-4 flex flex-wrap items-baseline gap-3"><strong className="text-5xl font-semibold tabular-nums tracking-tight text-brand-ink">{Math.round((correct / questions.length) * 100)}%</strong><h2 className="text-xl font-semibold text-foreground">You finished this quiz</h2></div>
        <p className="mt-5 border-y border-border py-4 text-sm text-muted-foreground"><span className="font-semibold text-[#347a52]">{correct} correct</span><span className="mx-2">·</span><span className="font-semibold text-clay">{missed.length} incorrect</span><span className="mx-2">·</span>{questions.length} questions</p>
        <h3 className="section-title mt-7">Missed Questions</h3>
        {missed.length === 0 ? <p className="mt-2 text-muted-foreground">None — you answered every question correctly.</p>
          : <ol className="mt-4 space-y-3">{missed.map(({ question, chosenAnswer }) => <li key={question.id} className="rounded-lg border border-border bg-paper p-4 sm:p-5"><p className="whitespace-pre-wrap break-words font-semibold text-ink">{question.prompt}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm text-clay">Your answer: {chosenAnswer}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#347a52]">Correct answer: {question.correctAnswer}</p></li>)}</ol>}
        <Link href={deckUrl} className={buttonVariants({ className: "mt-7 w-full sm:w-auto" })}>Exit</Link>
      </section>
    );
  }

  if (index < 0 || index >= questions.length) return <div className="mt-8"><p role="alert" className="notice-error">This quiz state is unavailable. Refresh to load saved progress.</p><div className="mt-4">{exit}</div></div>;
  const question = questions[index];
  const selectedKey = answers[index] ?? null;
  const answered = selectedKey !== null;
  const isCorrect = selectedKey === question.correctKey;
  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="page-eyebrow">Multiple-choice quiz</p><div className="flex items-center gap-3"><p className="text-sm font-medium tabular-nums text-muted-foreground">Question {index + 1} of {questions.length}</p>{exit}</div></div>
      <div className="study-progress mt-3" aria-hidden="true"><div style={{ width: `${Math.round((index / questions.length) * 100)}%` }} /></div>
      <div className="study-surface mt-5 flex min-h-48 flex-col justify-center"><p className="page-eyebrow">Prompt</p><h2 className="study-prompt mt-4 whitespace-pre-wrap">{question.prompt}</h2>{question.promptImageUrl && <Image unoptimized src={question.promptImageUrl} alt="Prompt illustration" width={640} height={400} className="mt-5 max-h-72 w-auto max-w-full rounded-md object-contain" />}</div>
      <p className="mt-6 text-sm font-semibold text-ink">Choose an answer</p>
      <div className="mt-3 grid gap-3">{question.options.map((option, optionIndex) => {
        const correctOption = answered && option.key === question.correctKey;
        const wrongChoice = answered && option.key === selectedKey && !isCorrect;
        return <button key={option.key} type="button" disabled={answered || busy} aria-pressed={selectedKey === option.key} onClick={() => void choose(option.key)} className={`quiz-choice flex items-center gap-3 whitespace-pre-wrap disabled:cursor-default ${correctOption ? "quiz-choice--correct" : wrongChoice ? "quiz-choice--wrong" : ""}`}><span className="quiz-choice__index" aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span><span className="flex-1">{option.label}</span>{correctOption && <Check className="size-5 shrink-0" aria-hidden="true" />}{wrongChoice && <X className="size-5 shrink-0" aria-hidden="true" />}</button>;
      })}</div>
      {answered && <div role="status" className={`mt-5 rounded-md p-4 ${isCorrect ? "bg-[#edf8ef] text-[#205c38]" : "bg-[#fff0f1] text-clay"}`}><p className="font-semibold">{isCorrect ? "Correct!" : "Not quite."}</p>{!isCorrect && <p className="mt-1 whitespace-pre-wrap break-words">Correct answer: {question.correctAnswer}</p>}</div>}
      {message && <p role="alert" className="notice-error mt-4">{message}</p>}
      {answered && <Button type="button" size="lg" disabled={busy} onClick={() => void next()} className="mt-6 w-full sm:w-auto">{busy ? "Saving…" : index === questions.length - 1 ? "See Results" : "Next Question"}</Button>}
      <p className="field-hint mt-5">Submitted answers are saved. Exit keeps this quiz unfinished.</p>
    </section>
  );
}
