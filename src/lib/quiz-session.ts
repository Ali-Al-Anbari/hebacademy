export type QuizQuestion = {
  id: string;
  prompt: string;
  promptImagePath: string | null;
  correctKey: string;
  correctAnswer: string;
  options: { key: string; label: string }[];
};

export type QuizProgress = {
  answers: string[];
  current_index: number;
  revision: number;
  completed_at: string | null;
};

export function readQuestions(value: unknown): QuizQuestion[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const question = item as Partial<QuizQuestion>;
    if (typeof question.id !== "string" || typeof question.prompt !== "string"
      || typeof question.correctKey !== "string" || typeof question.correctAnswer !== "string"
      || (question.promptImagePath !== null && typeof question.promptImagePath !== "string")
      || !Array.isArray(question.options) || question.options.length < 2
      || question.options.some((option) => !option || typeof option.key !== "string"
        || typeof option.label !== "string")
      || !question.options.some((option) => option.key === question.correctKey)
      || new Set(question.options.map((option) => option.key)).size !== question.options.length) return null;
  }
  return value as QuizQuestion[];
}

export function readAnswers(value: unknown, questions: QuizQuestion[]): string[] | null {
  if (!Array.isArray(value) || value.length > questions.length) return null;
  if (value.some((key, index) => typeof key !== "string"
    || !questions[index].options.some((option) => option.key === key))) return null;
  return value as string[];
}
