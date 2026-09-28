/* eslint-disable @typescript-eslint/no-require-imports -- Node's CJS hook loads the repository's pure TypeScript modules without another dependency. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

// Run the existing pure TypeScript utilities with Node's built-in test runner.
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(compiled.outputText, filename);
};

const { generateAssignmentOccurrences, resolveEffectiveAssignments } =
  require("../src/lib/planner/recurrence.ts");
const { selectVirtualDashboardSubtasks, virtualSubtaskLookaheadDays } =
  require("../src/lib/planner/dashboard-subtasks.ts");

const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const semester = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Fall",
  start_date: "2026-09-01",
  end_date: "2026-10-05",
  time_zone: "America/New_York",
  archived_at: null,
  created_at: "",
};

function root(overrides = {}) {
  return {
    id: ROOT_ID, semester_id: semester.id, planner_course_id: null,
    parent_series_id: null, original_due_date: null,
    title: "Weekly work", description: null, start_date: null,
    due_date: "2026-10-01", due_time: null, type_kind: "homework",
    custom_type_id: null, status: "not_started", priority: "normal",
    recurrence_kind: "weekly", recurrence_interval: 1,
    recurrence_weekdays: null, recurrence_end_kind: "never",
    recurrence_until: null, created_at: "", updated_at: "", ...overrides,
  };
}

function dates(rule, start = "2026-10-01", end = "2026-10-16") {
  return generateAssignmentOccurrences(rule, semester, start, end).map((item) => item.dueDate);
}

test("semester, date, and never have distinct termination bounds", () => {
  assert.deepEqual(dates(root({ recurrence_end_kind: "semester_end" })), ["2026-10-01"]);
  assert.deepEqual(dates(root({ recurrence_end_kind: "date", recurrence_until: "2026-10-12" })),
    ["2026-10-01", "2026-10-08"]);
  assert.deepEqual(dates(root(), "2026-10-08", "2026-10-08"), ["2026-10-08"]);
  assert.deepEqual(dates(root()), ["2026-10-01", "2026-10-08", "2026-10-15"]);
});

test("all five recurrence patterns stay bounded by the requested window", () => {
  assert.deepEqual(dates(root({ recurrence_kind: "daily" }), "2026-10-07", "2026-10-09"),
    ["2026-10-07", "2026-10-08", "2026-10-09"]);
  assert.deepEqual(dates(root({ recurrence_kind: "selected_weekdays", recurrence_weekdays: [1, 4] })),
    ["2026-10-01", "2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]);
  assert.deepEqual(dates(root()), ["2026-10-01", "2026-10-08", "2026-10-15"]);
  assert.deepEqual(dates(root({ recurrence_kind: "every_x_weeks", recurrence_interval: 2 })),
    ["2026-10-01", "2026-10-15"]);
  assert.deepEqual(dates(root({ recurrence_kind: "monthly" }), "2026-10-01", "2026-12-05"),
    ["2026-10-01", "2026-11-01", "2026-12-01"]);
});

test("virtual dated subtasks shift, appear in due buckets, and retain template identity", () => {
  const template = { id: TASK_ID, assignment_id: ROOT_ID, title: "Prepare",
    is_done: false, due_date: "2026-09-30", position: 0 };
  const resolved = resolveEffectiveAssignments({
    assignments: [root()], semester, rangeStart: "2026-10-01",
    rangeEnd: "2026-10-16", subtasks: [template],
  });
  const next = selectVirtualDashboardSubtasks(resolved.assignments, "2026-10-07", "2026-10-09");
  assert.deepEqual(next.next3Days.map((item) => item.subtask.due_date), ["2026-10-07"]);
  assert.equal(next.next3Days[0].templateSubtaskId, TASK_ID);
  assert.equal(next.next3Days[0].assignment.originalOccurrenceDate, "2026-10-08");
  const overdue = selectVirtualDashboardSubtasks(resolved.assignments, "2026-10-10", "2026-10-12");
  assert(overdue.overdue.some((item) => item.subtask.due_date === "2026-10-07"));
  assert.equal(template.is_done, false);
  assert.equal(template.due_date, "2026-09-30");
});

test("dashboard lookahead includes a subtask due before its later occurrence", () => {
  const template = { id: TASK_ID, assignment_id: ROOT_ID, title: "Prepare",
    is_done: false, due_date: "2026-09-25", position: 0 };
  const lead = virtualSubtaskLookaheadDays([root()], [template]);
  assert.equal(lead, 6);
  const { addDays } = require("../src/lib/planner/dates.ts");
  const resolved = resolveEffectiveAssignments({
    assignments: [root()], semester, rangeStart: "2026-09-01",
    rangeEnd: addDays("2026-10-09", lead), subtasks: [template],
  });
  const due = selectVirtualDashboardSubtasks(resolved.assignments, "2026-10-07", "2026-10-09");
  assert(due.next3Days.some((item) => item.assignment.due_date === "2026-10-15"
    && item.subtask.due_date === "2026-10-09"));
});

test("materialized occurrence suppresses its virtual subtask without duplicate", () => {
  const template = { id: TASK_ID, assignment_id: ROOT_ID, title: "Prepare",
    is_done: false, due_date: "2026-09-30", position: 0 };
  const materialized = root({
    id: "44444444-4444-4444-8444-444444444444",
    parent_series_id: ROOT_ID, original_due_date: "2026-10-08",
    due_date: "2026-10-08", recurrence_kind: "none",
    recurrence_end_kind: "none",
  });
  const resolved = resolveEffectiveAssignments({
    assignments: [root(), materialized], semester,
    rangeStart: "2026-10-08", rangeEnd: "2026-10-08",
    subtasks: [template, { ...template,
      id: "55555555-5555-4555-8555-555555555555",
      assignment_id: materialized.id, due_date: "2026-10-07", is_done: true }],
  });
  assert.equal(resolved.assignments.filter((item) => item.originalOccurrenceDate === "2026-10-08").length, 1);
  assert.equal(resolved.assignments[0].subtasks[0].is_done, true);
  assert.equal(template.is_done, false);
  const due = selectVirtualDashboardSubtasks(resolved.assignments, "2026-10-07", "2026-10-09");
  assert.equal(due.next3Days.length + due.overdue.length, 0);
});

test("normal assignment subtasks remain persisted and are never synthetic", () => {
  const normal = root({ recurrence_kind: "none", recurrence_end_kind: "none" });
  const resolved = resolveEffectiveAssignments({
    assignments: [normal], semester,
    rangeStart: "2026-10-01", rangeEnd: "2026-10-01",
    subtasks: [{ id: TASK_ID, assignment_id: ROOT_ID, title: "Prepare",
      is_done: false, due_date: "2026-10-01", position: 0 }],
  });
  assert.equal(resolved.assignments[0].subtasks[0].id, TASK_ID);
  assert.equal(selectVirtualDashboardSubtasks(resolved.assignments, "2026-10-01", "2026-10-03").next3Days.length, 0);
});
