// Tests for the agent benchmark task suite and its validator (tools/bench-tasks.mjs).
// Picked up by `npm test` through the tools/*.test.mjs glob, so `npm run check` validates
// planning/bench/tasks.json — statically and with live offline CLI runs — on every PR.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALLOWED_FLAGS,
  dynamicCheck,
  KNOWN_EXIT_CODES,
  loadTasks,
  TASK_COUNT,
  TASKS_FILE,
  validateTasks,
  WORKSPACE_FOLDER,
  cliContracts,
} from "./bench-tasks.mjs";

const contracts = await cliContracts();
const shipped = loadTasks();

/** A minimal shape of a task the static rules accept; tests mutate one field at a time. */
function makeTask(overrides = {}) {
  return {
    id: "sample-task",
    title: "A sample task",
    prompt: "Fix the seeded problem.",
    start: "fixtures/clean/minimal/site",
    criteria: [
      { id: "no-errors", argv: ["verify", WORKSPACE_FOLDER, "--fail-on", "error"], expect_exit: 0, proves: ["links.internal"] },
    ],
    ...overrides,
  };
}

function makeData(tasks) {
  return { version: 0, tasks };
}

/** The shipped suite padded or trimmed to the task count, for static-only validation. */
function tasksAtCount() {
  const base = structuredClone(shipped.tasks);
  while (base.length < TASK_COUNT) base.push(structuredClone(base[base.length % 10]));
  return base;
}

function staticErrors(data, extra = {}) {
  return validateTasks(data, { ...contracts, ...extra });
}

test(`the shipped ${TASKS_FILE} passes every static rule`, () => {
  assert.deepEqual(staticErrors(shipped), []);
});

test("the suite is exactly 10 tasks with unique slug ids and at least one criterion each", () => {
  assert.equal(shipped.tasks.length, 10);
  const ids = shipped.tasks.map((task) => task.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const task of shipped.tasks) {
    assert.match(task.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(task.title.length > 0 && task.prompt.length > 0);
    assert.ok(task.criteria.length >= 1 && task.criteria.length <= 4);
    for (const criterion of task.criteria) {
      assert.deepEqual(criterion.argv.slice(0, 2), ["verify", WORKSPACE_FOLDER]);
      assert.ok(KNOWN_EXIT_CODES.includes(criterion.expect_exit));
    }
  }
});

test("every criterion flag in the suite is a real seaworthy CLI flag, and the CLI still owns them", () => {
  for (const flag of ALLOWED_FLAGS) assert.ok(contracts.knownFlags.has(flag), `${flag} was renamed or removed in the CLI`);
  assert.ok(contracts.defaultFolders.includes(WORKSPACE_FOLDER), `${WORKSPACE_FOLDER} is no longer a default built folder`);
  const usedFlags = new Set(shipped.tasks.flatMap((task) => task.criteria.flatMap((c) => c.argv.filter((t) => t.startsWith("--")))));
  assert.ok(usedFlags.size >= 2, "the suite should exercise more than one gate flag");
});

test("every proves ID is a check the built registry knows", () => {
  for (const task of shipped.tasks) {
    for (const criterion of task.criteria) {
      for (const id of criterion.proves) assert.ok(contracts.knownCheckIds.has(id), `${task.id}/${criterion.id}: unknown check ${id}`);
    }
  }
});

test("live and offline: each criterion fails on its untouched start and passes on its reference", () => {
  // 22 CLI runs of small fixture sites; this is what makes the criteria machine-checkable
  // rather than aspirational. Fully offline — criteria may not carry --network/--rendered.
  assert.deepEqual(dynamicCheck(shipped), []);
}, { timeout: 180_000 });

test("the empty baseline seed is exactly what the engine writes for a site with no findings", async () => {
  const baseline = loadTasks(TASKS_FILE.replace("tasks.json", "seeds/empty-baseline.json"));
  assert.deepEqual(baseline, { spec: 0, tool: "seaworthy", entries: [] });
});

test("static rules reject a suite that is not exactly 10 unique, well-formed tasks", () => {
  assert.ok(staticErrors(makeData([])).some((e) => e.includes("exactly 10 tasks")));
  assert.ok(staticErrors(makeData(tasksAtCount().slice(0, 9))).some((e) => e.includes("exactly 10 tasks")));
  const duplicated = tasksAtCount();
  duplicated[9] = { ...duplicated[0], id: duplicated[1].id };
  assert.ok(staticErrors(makeData(duplicated)).some((e) => e.includes("duplicate task id")));
  assert.ok(staticErrors(makeData(tasksAtCount().map((t, i) => (i === 0 ? { ...t, id: "Bad Id" } : t))))
    .some((e) => e.includes("id must match")));
  assert.ok(staticErrors(makeData(tasksAtCount().map((t, i) => (i === 0 ? { ...t, title: "" } : t))))
    .some((e) => e.includes("title must be a non-empty string")));
});

test("a criterion must be one argv-only verify call against the workspace folder", () => {
  const withCriterion = (criterion) => makeData([makeTask({ criteria: [criterion] }), ...tasksAtCount().slice(1, TASK_COUNT)]);
  const errors = (criterion) => staticErrors(withCriterion(criterion));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--fail-on", "error", "&&", "rm", "-rf", "/"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("shell-safe")));
  assert.ok(errors({ id: "c", argv: ["diff", WORKSPACE_FOLDER], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("argv[0] must be the verify command")));
  assert.ok(errors({ id: "c", argv: ["verify", "dist", "--fail-on", "error"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("workspace folder")));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--fail-on"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("needs a value")));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--network"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("not allowed in a criterion")));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--watch", "true"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("not allowed in a criterion")));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--format", "json"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("not allowed in a criterion")));
  // An allowed flag that the CLI no longer has fails the drift check, not the allow-list check.
  const drift = staticErrors(withCriterion({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--base", "/docs/"], expect_exit: 0, proves: ["links.internal"] }), { knownFlags: new Set(["--fail-on"]) });
  assert.ok(drift.some((e) => e.includes("not a real seaworthy CLI flag")));
  assert.ok(!drift.some((e) => e.includes("not allowed in a criterion")));
});

test("--fail-on none, unknown exit codes, and unseeded baselines cannot decide a criterion", () => {
  const errors = (criterion, task = {}) => staticErrors(makeData([{ ...makeTask(task), criteria: [criterion] }, ...tasksAtCount().slice(0, 9)]));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--fail-on", "none"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("cannot decide a criterion")));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--fail-on", "critical"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("cannot decide a criterion")));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--fail-on", "error"], expect_exit: 3, proves: ["links.internal"] }).some((e) => e.includes("expect_exit")));
  assert.ok(errors({ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--baseline", "b.json", "--fail-on", "error"], expect_exit: 0, proves: ["links.internal"] }).some((e) => e.includes("not one of the task's seed files")));
});

test("starts, references, seeds, and proves must name things that exist", () => {
  const data = makeData([{ ...makeTask(), start: "fixtures/broken/does-not-exist/site", seeds: [{ file: "x.json", from: "planning/bench/nope.json" }], criteria: [{ id: "c", argv: ["verify", WORKSPACE_FOLDER, "--fail-on", "error"], expect_exit: 0, proves: ["check.does-not-exist"] }] }, ...tasksAtCount().slice(0, 9)]);
  const errors = staticErrors(data);
  assert.ok(errors.some((e) => e.includes("does not exist in the repository") && e.includes("start")));
  assert.ok(errors.some((e) => e.includes("seed source")));
  assert.ok(errors.some((e) => e.includes("proves names a check that does not exist")));
  assert.ok(staticErrors(makeData([{ ...makeTask(), start: "docs/agent-loop.md" }, ...tasksAtCount().slice(0, 9)])).some((e) => e.includes("must be a fixtures/ path")));
});
