/* eslint-disable @typescript-eslint/no-require-imports -- Use the existing Node test setup for a pure TypeScript utility. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(compiled.outputText, filename);
};

const { persistStickyTextDraft, sameStickyNoteContent, stickyNoteSavePayload, stickyNoteTextChanged } = require("../src/lib/sticky-note-state.ts");
const saved = { title: "", body: "Study optics", color: "pink", x: 24, y: 88, width: 260, height: 220 };

test("unchanged saved notes are clean", () => {
  assert.equal(sameStickyNoteContent(saved, { ...saved }), true);
});

test("each editable field can make a saved note dirty", () => {
  for (const change of [
    { title: "Exam" }, { body: "Study anatomy" }, { color: "yellow" },
    { x: 25 }, { y: 89 }, { width: 280 }, { height: 240 },
  ]) assert.equal(sameStickyNoteContent(saved, { ...saved, ...change }), false);
});

test("restoring the last saved fields clears dirty state", () => {
  const dirty = { ...saved, body: "Unsaved edit", x: 40 };
  assert.equal(sameStickyNoteContent(dirty, saved), false);
  assert.equal(sameStickyNoteContent({ ...dirty, body: saved.body, x: saved.x }, saved), true);
});

test("text draft changes stay separate until an explicit save payload is built", () => {
  const draft = { title: "Biology Exam", body: "Review chapters 4, 5, and 6" };
  assert.equal(stickyNoteTextChanged(draft, saved), true);
  assert.equal(saved.title, "");
  assert.equal(saved.body, "Study optics");
  const payload = stickyNoteSavePayload({ ...saved, ...draft, id: "note-id", is_open: true }, "owner-id", true);
  assert.equal(payload.title, "Biology Exam");
  assert.equal(payload.body, draft.body);
});

test("blank title is persisted when supported and omitted only for an older schema", () => {
  const note = { ...saved, id: "note-id", is_open: true, x: 24.6 };
  const current = stickyNoteSavePayload(note, "owner-id", true);
  const legacy = stickyNoteSavePayload(note, "owner-id", false);
  assert.equal(current.title, "");
  assert.equal(Object.hasOwn(legacy, "title"), false);
  assert.equal(current.x, 25);
});

test("discarding a text draft restores the last saved title and body", () => {
  const persisted = { ...saved, title: "Biology", body: "Review chapter 4" };
  const draft = { title: "", body: "Review chapters 4, 5, and 6" };
  assert.equal(stickyNoteTextChanged(draft, persisted), true);
  assert.equal(stickyNoteTextChanged({ title: persisted.title, body: persisted.body }, persisted), false);
});

test("failed draft persistence leaves the saved snapshot untouched and permits retry", async () => {
  const original = { ...saved, title: "Biology", body: "Chapter 4" };
  const draft = { title: "Biology Exam", body: "Chapters 4 and 5" };
  let calls = 0;
  await assert.rejects(persistStickyTextDraft(original, draft, async () => { calls++; throw new Error("network failure"); }), /network failure/);
  assert.equal(original.title, "Biology");
  assert.equal(original.body, "Chapter 4");
  let submitted;
  const result = await persistStickyTextDraft(original, draft, async (next) => { calls++; submitted = next; });
  assert.equal(calls, 2);
  assert.equal(result.title, draft.title);
  assert.equal(submitted.body, draft.body);
});
