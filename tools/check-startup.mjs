// Fails when the built `seaworthy --version` CLI takes longer than the startup budget to run.
// The 150 ms budget and the rationale come from docs/adr/0004-cli-runtime.md (issue #299).
//
//   npm run build           # the gate runs the built CLI, packages/verify/dist/src/cli.js
//   npm run check:startup   # run it alone; also part of `npm run check`
//
// Usage: node tools/check-startup.mjs [--budget 150] [--runs 5]
//
// Measurement strategy (chosen so a loaded CI runner does not flakily fail):
//   1. One warm-up run, not timed, to prime OS caches for the Node binary and the script.
//   2. N timed runs (default 5), one at a time — concurrent starts contend for CPU and
//      inflate every wall time. Wall time is measured from spawn to exit, so it includes
//      everything a user would pay. Each CLI run is interleaved with a bare-Node run
//      (`node -e "") timed the same way, the host floor.
//   3. The gate judges the BEST run, not the mean: a preemption or page fault by another
//      process adds to one sample, but cannot slow every sample of a fast CLI.
//   4. The gate fails when the best run is over the absolute budget AND seaworthy's own
//      overhead over the host floor is over half the budget. Normally the first clause
//      alone decides. But on a runner so throttled that even bare Node spends most of the
//      budget, the absolute number is unmeasurable — an empty script already "failed" —
//      so the overhead clause decides: a real regression (CLI much slower than bare Node)
//      still fails, a slow host does not.
//   5. Before each retry pass the gate waits SETTLE_MS so a burst of load left over from
//      the build and test stages can drain; up to MAX_SAMPLES runs. Failing then means
//      every measured run was over budget and slow for its own sake, not the host's.
// Every run must also exit 0 and print a semver line; a wrong output fails immediately
// because that is a broken build, not a slow startup.

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(root, "packages", "verify", "dist", "src", "cli.js");

const DEFAULT_BUDGET_MS = 150;
const DEFAULT_RUNS = 5;
const MAX_SAMPLES = 15;
const SETTLE_MS = 5_000; // Before a retry pass, let leftover runner load drain.
const floorBudget = (budgetMs) => budgetMs / 2; // seaworthy's own startup overhead must stay under this.
const VERSION_PATTERN = /^\d+\.\d+\.\d+\n$/;

export const BUDGET_MS = DEFAULT_BUDGET_MS;

/**
 * The gate decision for wall-time samples in ms.
 * `floorMs`, when given, is the measured bare-Node floor the CLI samples are compared against.
 */
export function verdict(samples, budgetMs, floorMs) {
  if (samples.length === 0) return { best: undefined, ok: false };
  const best = Math.min(...samples);
  if (best <= budgetMs) return { best, floor: floorMs, ok: true, by: "budget" };
  // Over the absolute budget: pass only if the host floor explains it (slow runner, fast CLI).
  const overhead = floorMs === undefined ? Infinity : best - floorMs;
  return { best, floor: floorMs, overhead, ok: overhead <= floorBudget(budgetMs), by: "overhead" };
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

/** Runs argv once and resolves its wall time in ms; verifies the CLI's version output. */
function timedRun(argv, expectVersion) {
  return new Promise((resolveRun, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, argv, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const ms = performance.now() - started;
      if (expectVersion && (code !== 0 || signal !== null || !VERSION_PATTERN.test(stdout))) {
        reject(new Error(`--version misbehaved (exit ${signal ?? code}, stdout ${JSON.stringify(stdout)})`));
        return;
      }
      resolveRun(ms);
    });
  });
}

const runCli = () => timedRun([CLI, "--version"], true);
const runFloor = () => timedRun(["-e", ""]);

async function main() {
  const { values } = parseArgs({
    options: {
      budget: { type: "string" },
      runs: { type: "string" },
    },
  });
  const budget = values.budget === undefined ? DEFAULT_BUDGET_MS : Number(values.budget);
  const runs = values.runs === undefined ? DEFAULT_RUNS : Number(values.runs);
  if (!Number.isFinite(budget) || budget <= 0) throw new Error(`--budget must be a positive number of ms, got ${values.budget}`);
  if (!Number.isInteger(runs) || runs <= 0) throw new Error(`--runs must be a positive integer, got ${values.runs}`);
  if (!existsSync(CLI)) throw new Error(`the built CLI is missing: ${CLI}. Run \`npm run build\` first.`);

  await runCli(); // warm-up

  // One sample at a time, the CLI interleaved with the floor so slow stretches touch both alike.
  const cli = [];
  const floor = [];
  const pass = async (count) => {
    for (let i = 0; i < count; i++) {
      floor.push(await runFloor());
      cli.push(await runCli());
    }
  };

  await pass(runs);
  let v = verdict(cli, budget, Math.min(...floor));
  while (!v.ok && cli.length < MAX_SAMPLES) {
    // Retry: a burst of load (this gate runs right after the build and tests in
    // `npm run check`) gets a chance to settle instead of tainting every sample.
    await delay(SETTLE_MS);
    await pass(runs);
    v = verdict(cli, budget, Math.min(...floor));
  }

  if (!v.ok) {
    console.error([
      `startup: seaworthy --version took ${Math.round(v.best)} ms on its best of ${cli.length} runs, over the ${budget} ms budget, and its own overhead ${Math.round(v.overhead)} ms also exceeds the ${floorBudget(budget)} ms overhead budget`,
      `startup: all runs: ${cli.map((ms) => Math.round(ms)).join(", ")} ms`,
      `startup: bare-Node floor on each pass: ${Math.round(v.floor)} ms best`,
      "startup: before relaxing anything, re-run on an idle machine (`npm run build && npm run check:startup`) or cut startup cost (`packages/verify/src/cli.ts` imports).",
    ].join("\n"));
    process.exit(1);
  }
  console.log(`OK: startup (best of ${cli.length} runs: ${Math.round(v.best)} ms, budget ${budget} ms, floor ${Math.round(v.floor)} ms)`);
}

// Run only when executed directly, not when imported by tests.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) await main();
