/* eslint-disable @typescript-eslint/no-require-imports -- Match the repository's Node test setup for pure TypeScript helpers. */
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

const { focusTextPatch } = require("../src/lib/planner/focus-edit.ts");
const timestamp = "2026-09-29T12:00:00.000Z";

test("multiline focus edits preserve internal line breaks and only update text metadata", () => {
  const source = "  Finish biology notes\nReview chapter 5\nStudy diagrams\nEmail professor  ";
  const patch = focusTextPatch(source, timestamp);
  assert.deepEqual(patch, {
    title: "Finish biology notes\nReview chapter 5\nStudy diagrams\nEmail professor",
    updated_at: timestamp,
  });
  assert.equal(Object.hasOwn(patch, "is_done"), false);
  assert.equal(Object.hasOwn(patch, "position"), false);
  assert.equal(Object.hasOwn(patch, "assignment_id"), false);
});

test("focus edit accepts a long unbroken URL and rejects blank or overlong text", () => {
  const url = `https://example.edu/${"course/".repeat(40)}`;
  assert.equal(focusTextPatch(url, timestamp)?.title, url);
  assert.equal(focusTextPatch("  \n  ", timestamp), null);
  assert.equal(focusTextPatch("x".repeat(501), timestamp), null);
});
