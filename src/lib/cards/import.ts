export const MAX_IMPORT_CARDS = 100;
const MAX_CARD_TEXT = 5000;

export type ImportCard = { prompt: string; answer: string };
export type ImportRow = ImportCard & { line: number; endLine: number };

function cleanText(text: string) {
  return text.replace(/\r\n?|\n/gu, "\n").trim();
}

export function cardPairKey(prompt: string, answer: string) {
  const normalize = (text: string) => cleanText(text).replace(/\s+/gu, " ").toLowerCase();
  return JSON.stringify([normalize(prompt), normalize(answer)]);
}

export function parseCardImport(source: string): ImportRow[] {
  const rows: ImportRow[] = [];
  let block: { line: number; text: string }[] = [];

  function finishBlock() {
    if (!block.length) return;
    rows.push({
      line: block[0].line,
      endLine: block.at(-1)!.line,
      prompt: cleanText(block[0].text),
      answer: cleanText(block.slice(1).map(({ text }) => text).join("\n")),
    });
    block = [];
  }

  source.split(/\r\n|\n|\r/u).forEach((line, index) => {
    if (!line.trim()) finishBlock();
    else block.push({ line: index + 1, text: line });
  });
  finishBlock();
  return rows;
}

export function validateImportCards(input: unknown) {
  if (!Array.isArray(input)) return null;

  const seen = new Map<string, number>();
  const candidates: ImportCard[] = [];
  let duplicateCount = 0;
  let errorCount = 0;
  const rows = input.map((value, index) => {
    const card = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const prompt = typeof card.prompt === "string" ? cleanText(card.prompt) : "";
    const answer = typeof card.answer === "string" ? cleanText(card.answer) : "";
    let error: string | null = null;
    let duplicateOf: number | null = null;

    if (!prompt || !answer) error = "Both the question and answer are required.";
    else if (prompt.includes("\n")) error = "The question must be one line.";
    else if (/\n[^\S\n]*\n/u.test(answer)) error = "Blank lines inside an answer are not supported.";
    else if (prompt.length > MAX_CARD_TEXT || answer.length > MAX_CARD_TEXT) {
      error = "Each field must be 5,000 characters or fewer.";
    } else {
      const key = cardPairKey(prompt, answer);
      duplicateOf = seen.get(key) ?? null;
      if (duplicateOf === null) {
        seen.set(key, index + 1);
        candidates.push({ prompt, answer });
      } else duplicateCount += 1;
    }

    if (error) errorCount += 1;
    return { prompt, answer, error, duplicateOf };
  });

  return { rows, candidates, duplicateCount, errorCount, limitExceeded: candidates.length > MAX_IMPORT_CARDS };
}
