// Tests for the benchmark runner (tools/bench-run.mjs, issue #102).
// Picked up by `npm test` through the tools/*.test.mjs glob, exactly like tools/bench-tasks.test.mjs,
// so `npm run check` proves the runner scores, reports and stays deterministic — without turning
// the benchmark's own score into a gate (only the contract is asserted here, never 10/10 solved).

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadTasks, WORKSPACE_FOLDER } from "./bench-tasks.mjs";
import { planFor, REFERENCE_SOLUTIONS, renderJson, renderText, runSuite, scoreTask } from "./bench-run.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const shipped = loadTasks();
const shippedTask = (id) => shipped.tasks.find((task) => task.id === id);

/** A synthetic task on the untouched clean site: its criteria are already satisfied. */
function alreadySolvedTask(level = "error") {
  return {
    id: "synthetic-solved",
    title: "A site that already passes",
    prompt: "Nothing to do.",
    start: "fixtures/clean/minimal/site",
    criteria: [{ id: "no-errors", argv: ["verify", WORKSPACE_FOLDER, "--fail-on", level], expect_exit: 0, proves: ["links.internal"] }],
  };
}

/** A synthetic task on a broken site whose gate is not met: the runner must score it fail. */
function unsolvedTask() {
  return {
    id: "synthetic-unsolved",
    title: "A site with a seeded warning",
    prompt: "Add the not-found page.",
    start: "fixtures/broken/not-found-page/site",
    criteria: [{ id: "clean-at-warning", argv: ["verify", WORKSPACE_FOLDER, "--fail-on", "warning"], expect_exit: 0, proves: ["quality.not-found-page"] }],
  };
}

test("a fixture whose state satisfies the criteria scores pass", () => {
  const result = scoreTask(alreadySolvedTask(), { ops: [] });
  assert.equal(result.verdict, "solved");
  assert.deepEqual(result.criteria.map((c) => c.verdict), ["pass"]);
  assert.equal(result.criteria[0].exitAfter, 0);
  assert.equal(result.solvedOnStart, true, "an untouched clean site matches its gate");
  assert.deepEqual(result.cliMutatedWorkspace, [], "no CLI run may change the workspace it scores");
});

test("a deliberately broken fixture scores fail, and the runner says why", () => {
  const result = scoreTask(unsolvedTask(), { ops: [] });
  assert.equal(result.verdict, "unsolved");
  const [criterion] = result.criteria;
  assert.equal(criterion.exitAfter, 1);
  assert.equal(criterion.verdict, "fail");
  assert.deepEqual(criterion.argv, ["verify", WORKSPACE_FOLDER, "--fail-on", "warning"]);
  const checks = criterion.unresolved.map((f) => f.checkId);
  assert.ok(checks.includes("quality.not-found-page"), `expected the seeded finding, got ${checks.join(", ")}`);
  for (const finding of criterion.unresolved) {
    assert.ok(finding.file.length > 0 && !finding.file.startsWith("/"), `locations stay workspace-relative: ${finding.file}`);
    assert.ok(finding.fixHint.length > 0, "every unresolved finding carries its fix hint");
  }
});

test("the scripted reference solution turns a failing gate green", () => {
  const task = shippedTask("add-not-found-page");
  const before = scoreTask(unsolvedTask(), { ops: [] });
  const after = scoreTask(task, { ops: REFERENCE_SOLUTIONS[task.id] });
  assert.equal(before.verdict, "unsolved");
  assert.equal(after.verdict, "solved");
  assert.equal(after.criteria[0].exitBefore, 1, "#101 requires the gate to be red on the untouched start");
  assert.equal(after.criteria[0].exitAfter, 0);
});

test("a reference solution that no longer fits the fixture fails loudly instead of passing", () => {
  const task = shippedTask("fix-broken-links");
  assert.throws(
    () => scoreTask(task, { ops: [{ replace: "site/index.html", find: `href="/docs/guid.html??"`, with: `href="/docs/guide.html"` }] }),
    /does not apply/,
  );
});

test("a task with no reference solution is reported as unsolved with a reason", () => {
  const orphan = { ...alreadySolvedTask(), id: "not-in-the-suite" };
  const report = runSuite({ version: 0, tasks: [orphan] });
  assert.equal(report.summary.unsolved, 1);
  assert.equal(report.tasks[0].verdict, "unsolved");
  assert.match(report.tasks[0].error, /no scripted reference solution/);
  assert.deepEqual(report.tasks[0].criteria.map((c) => c.verdict), ["skipped"]);
});

test("the plan and the summary counts match planning/bench/tasks.json", () => {
  const plan = planFor(shipped);
  assert.equal(plan.length, shipped.tasks.length);
  assert.equal(plan.reduce((sum, t) => sum + t.criteria.length, 0), shipped.tasks.reduce((sum, t) => sum + t.criteria.length, 0));
  assert.deepEqual(plan.map((t) => t.id), shipped.tasks.map((t) => t.id));
  for (const task of shipped.tasks) {
    assert.ok(REFERENCE_SOLUTIONS[task.id], `task ${task.id} has no scripted reference solution`);
    for (const criterion of planFor({ tasks: [task] })[0].criteria) {
      const source = task.criteria.find((c) => c.id === criterion.id);
      assert.deepEqual(criterion.argv, source.argv);
      assert.equal(criterion.expectExit, source.expect_exit);
    }
  }
  const subset = runSuite(shipped, { only: ["fix-broken-links", "migrate-base-url"] });
  assert.equal(subset.summary.tasks, 2);
  assert.equal(subset.summary.criteria, 2);
  assert.equal(subset.summary.solved, 2);
  assert.equal(subset.summary.criteriaGreen, 2);
  assert.equal(subset.summary.verifyRuns, 4, "each criterion runs once on the start and once on the solved site");
  assert.equal(subset.summary.fixPreviews, 2);
}, { timeout: 120_000 });

test("--json output is byte-stable across runs and leaks nothing local", () => {
  const args = [join(repoRoot, "tools/bench-run.mjs"), "--json", "--task", "fix-image-alternatives", "--task", "migrate-base-url"];
  const first = spawnSync(process.execPath, args, { encoding: "utf8" });
  const second = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout, "the JSON report must diff clean in CI");
  const report = JSON.parse(first.stdout);
  assert.equal(report.offline, true);
  assert.equal(report.tasksFile, "planning/bench/tasks.json");
  assert.deepEqual(report.tasks.map((t) => t.id), ["fix-image-alternatives", "migrate-base-url"], "tasks keep the task file order");
  const text = first.stdout;
  for (const forbidden of [tmpdir(), "/Users/", "/var/folders", "generatedAt", "timestamp"]) {
    assert.ok(!text.includes(forbidden), `the compared fields must not contain ${forbidden}`);
  }
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T/, "no ISO timestamps anywhere in the report");
  assert.match(renderText(report), /^seaworthy bench run \(offline\)/);
  assert.equal(renderJson(report), `${JSON.stringify(report, null, 2)}\n`);
}, { timeout: 120_000 });

test("the runner keeps every task file it scores untouched", () => {
  // It edits only its own temp workspaces: planning/bench/tasks.json is #101's, read-only here.
  const before = readFileSync(join(repoRoot, "planning/bench/tasks.json"), "utf8");
  runSuite(shipped, { only: ["pass-baseline-gate"] });
  assert.equal(readFileSync(join(repoRoot, "planning/bench/tasks.json"), "utf8"), before);
}, { timeout: 120_000 });
