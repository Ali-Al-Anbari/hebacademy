"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type QuizQuestion = {
  id: string;
  prompt: string;
  promptImageUrl: string | null;
  correctKey: string;
  correctAnswer: string;
  options: { key: string; label: string }[];
};

type Result = {
  question: QuizQuestion;
  chosenAnswer: string;
  correct: boolean;
};

export function QuizView({ questions, deckUrl }: { questions: QuizQuestion[]; deckUrl: string }) {
  const [index, setIndex] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  if (index === questions.length) {
    const correct = results.filter((result) => result.correct).length;
    const missed = results.filter((result) => !result.correct);
    return (
      <section className="study-surface mt-5">
        <p className="page-eyebrow">Quiz complete</p>
        <div className="mt-4 flex flex-wrap items-baseline gap-3"><strong className="text-5xl font-semibold tabular-nums tracking-tight text-primary">{Math.round((correct / questions.length) * 100)}%</strong><h2 className="text-xl font-semibold text-foreground">You finished this quiz</h2></div>
        <p className="mt-5 border-y border-border py-4 text-sm text-muted-foreground"><span className="font-semibold text-[#347a52]">{correct} correct</span><span className="mx-2">·</span><span className="font-semibold text-clay">{missed.length} incorrect</span><span className="mx-2">·</span>{questions.length} questions</p>
        <h3 className="section-title mt-7">Missed Questions</h3>
        {missed.length === 0 ? (
          <p className="mt-2 text-muted-foreground">None — you answered every question correctly.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {missed.map((result) => (
              <li key={result.question.id} className="rounded-xl bg-paper p-4 sm:p-5">
                <p className="whitespace-pre-wrap break-words font-semibold text-ink">{result.question.prompt}</p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-clay">Your answer: {result.chosenAnswer}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#347a52]">Correct answer: {result.question.correctAnswer}</p>
              </li>
            ))}
          </ol>
        )}
        <Button render={<Link href={deckUrl} />} className="mt-7 w-full sm:w-auto">Back to Deck</Button>
      </section>
    );
  }

  const question = questions[index];
  const answered = selectedKey !== null;
  const isCorrect = selectedKey === question.correctKey;

  function nextQuestion() {
    if (!answered) return;
    const chosenAnswer = question.options.find((option) => option.key === selectedKey)?.label ?? "";
    setResults((current) => [...current, { question, chosenAnswer, correct: isCorrect }]);
    setSelectedKey(null);
    setIndex((current) => current + 1);
  }

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between"><p className="page-eyebrow">Multiple-choice quiz</p><p className="text-sm font-medium tabular-nums text-muted-foreground">Question {index + 1} of {questions.length}</p></div>
      <div className="study-progress mt-3" aria-hidden="true">
        <div style={{ width: `${Math.round((index / questions.length) * 100)}%` }} />
      </div>
      <div className="study-surface mt-5 flex min-h-48 flex-col justify-center">
        <p className="page-eyebrow">Prompt</p>
        <h2 className="study-prompt mt-4 whitespace-pre-wrap">{question.prompt}</h2>
        {question.promptImageUrl && <Image unoptimized src={question.promptImageUrl} alt="Prompt illustration" width={640} height={400} className="mt-5 max-h-72 w-auto max-w-full rounded-md object-contain" />}
      </div>
      <p className="mt-6 text-sm font-semibold text-ink">Choose an answer</p>
      <div className="mt-3 grid gap-3">
        {question.options.map((option, optionIndex) => {
            const correctOption = answered && option.key === question.correctKey;
            const wrongChoice = answered && option.key === selectedKey && !isCorrect;
            const color = correctOption
              ? "quiz-choice--correct"
              : wrongChoice
                ? "quiz-choice--wrong"
                : "";
            return (
              <button key={option.key} type="button" disabled={answered} aria-pressed={selectedKey === option.key} onClick={() => setSelectedKey(option.key)} className={`quiz-choice flex items-center gap-3 whitespace-pre-wrap disabled:cursor-default ${color}`}>
                <span className="quiz-choice__index" aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span><span className="flex-1">{option.label}</span>{correctOption && <Check className="size-5 shrink-0" aria-hidden="true" />}{wrongChoice && <X className="size-5 shrink-0" aria-hidden="true" />}
              </button>
            );
        })}
      </div>
      {answered && (
        <div role="status" className={`mt-5 rounded-md p-4 ${isCorrect ? "bg-[#edf8ef] text-[#205c38]" : "bg-[#fff0f1] text-clay"}`}>
          <p className="font-semibold">{isCorrect ? "Correct!" : "Not quite."}</p>
          {!isCorrect && <p className="mt-1 whitespace-pre-wrap break-words">Correct answer: {question.correctAnswer}</p>}
        </div>
      )}
      {answered && <Button type="button" size="lg" onClick={nextQuestion} className="mt-6 w-full sm:w-auto">{index === questions.length - 1 ? "See Results" : "Next Question"}</Button>}
    </section>
  );
}
