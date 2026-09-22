"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

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
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-teal-700">Quiz complete</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">You finished this deck</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-teal-50 p-4"><p className="text-sm text-teal-800">Correct</p><p className="mt-1 text-2xl font-semibold text-teal-900">{correct}</p></div>
          <div className="rounded-lg bg-rose-50 p-4"><p className="text-sm text-rose-800">Incorrect</p><p className="mt-1 text-2xl font-semibold text-rose-900">{missed.length}</p></div>
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-700">Score</p><p className="mt-1 text-2xl font-semibold text-slate-900">{Math.round((correct / questions.length) * 100)}%</p></div>
        </div>
        <h3 className="mt-8 text-lg font-semibold text-slate-900">Missed Questions</h3>
        {missed.length === 0 ? (
          <p className="mt-2 text-slate-600">None — you answered every question correctly.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {missed.map((result) => (
              <li key={result.question.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="whitespace-pre-wrap break-words font-medium text-slate-900">{result.question.prompt}</p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-rose-800">Your answer: {result.chosenAnswer}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-teal-800">Correct answer: {result.question.correctAnswer}</p>
              </li>
            ))}
          </ol>
        )}
        <Link href={deckUrl} className="mt-7 inline-flex rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">Back to Deck</Link>
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
    <section className="mt-8">
      <p className="text-sm font-medium text-teal-700">Question {index + 1} of {questions.length}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        <div className="h-full rounded-full bg-teal-700" style={{ width: `${Math.round((index / questions.length) * 100)}%` }} />
      </div>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Prompt</p>
        <h2 className="mt-3 whitespace-pre-wrap break-words text-xl font-semibold text-slate-900 sm:text-2xl">{question.prompt}</h2>
        {question.promptImageUrl && <Image unoptimized src={question.promptImageUrl} alt="Prompt illustration" width={640} height={400} className="mt-5 max-h-72 w-auto max-w-full rounded-lg object-contain" />}
        <p className="mt-8 text-sm font-medium text-slate-700">Choose an answer</p>
        <div className="mt-3 grid gap-3">
          {question.options.map((option) => {
            const correctOption = answered && option.key === question.correctKey;
            const wrongChoice = answered && option.key === selectedKey && !isCorrect;
            const color = correctOption
              ? "border-teal-400 bg-teal-50 text-teal-900"
              : wrongChoice
                ? "border-rose-400 bg-rose-50 text-rose-900"
                : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50";
            return (
              <button key={option.key} type="button" disabled={answered} onClick={() => setSelectedKey(option.key)} className={`min-h-12 w-full rounded-lg border px-4 py-3 text-left font-medium leading-relaxed whitespace-pre-wrap break-words focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-default ${color}`}>
                {option.label}
              </button>
            );
          })}
        </div>
        {answered && (
          <div role="status" className={`mt-6 rounded-lg p-4 ${isCorrect ? "bg-teal-50 text-teal-900" : "bg-rose-50 text-rose-900"}`}>
            <p className="font-semibold">{isCorrect ? "Correct!" : "Not quite."}</p>
            {!isCorrect && <p className="mt-1 whitespace-pre-wrap break-words">Correct answer: {question.correctAnswer}</p>}
          </div>
        )}
        {answered && <button type="button" onClick={nextQuestion} className="mt-6 min-h-12 w-full rounded-lg bg-teal-700 px-5 py-2.5 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:w-auto">{index === questions.length - 1 ? "See Results" : "Next Question"}</button>}
      </div>
    </section>
  );
}
