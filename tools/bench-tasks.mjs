// Validates the agent benchmark task suite: planning/bench/tasks.json.
//
// A success criterion counts as machine-checkable only if a command with a known exit
// code decides it. This tool enforces that definition mechanically:
//   - the data file holds exactly 10 tasks, each with unique id, title, prompt, start,
//     and 1..4 criteria (the suite is the 10 tasks the issue asks for, no more, no less);
//   - every criterion is one real `seaworthy verify` invocation as an argv array (no
//     shell), with a folder argument that is one of the CLI's default built folders
//     (packages/verify/src/folders.ts), only flags that exist in the built CLI's option
//     groups, and an expect_exit inside the documented set 0 / 1 / 2 / 4
//     (packages/verify/src/cli/types.ts);
//   - `proves` names check IDs that exist in the built check registry;
//   - run live (and by tools/bench-tasks.test.mjs on every `npm run check`): each
//     criterion must NOT already pass on an untouched copy of the task's start fixture
//     (the task is real work), and it must pass on the task's reference site
//     (fixtures/clean/minimal by default) — so every gate is discriminating and passable,
//     fully offline.
//
// Usage:
//   node tools/bench-tasks.mjs            # validate the shipped suite (needs `npm run build`)
//   node tools/bench-tasks.mjs --quick    # static rules only, no CLI runs
//
// The runner contract (which folder the criteria run against, how seeds are placed) is
// documented in planning/bench/README.md; executing the tasks and scoring agents is
// bench.runner (#102), not this file.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const TASKS_FILE = "planning/bench/tasks.json";
export const TASK_COUNT = 10;
/** The workspace folder criteria are scored against; must stay a default built folder. */
export const WORKSPACE_FOLDER = "site";
/** The exit codes the CLI documents: 0 clean, 1 findings at or above --fail-on, 2 usage, 4 crash. */
export const KNOWN_EXIT_CODES = [0, 1, 2, 4];
/** --fail-on "none" always exits 0, so it can never decide a criterion. */
export const FAIL_ON_LEVELS = ["error", "warning", "note"];
/** Flags a criterion may use. Every one is also checked against the real CLI flags. */
export const ALLOWED_FLAGS = ["--fail-on", "--base", "--baseline"];

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Tokens are passed to the CLI as data, never to a shell; anything shell-ish is rejected. */
const TOKEN_PATTERN = /^[A-Za-z0-9_./:=@+-]+$/;
/** Baseline and seed file names are workspace-root-relative plain file names. */
const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** The subset of pathExists that needs the filesystem; injectable for unit tests. */
const repoPathExists = (relativePath) => existsSync(join(root, relativePath));

/** True when the folder at the repo-relative path contains at least one .html file. */
function hasHtml(relativeDir) {
  const abs = join(root, relativeDir);
  if (!existsSync(abs)) return false;
  const stack = [abs];
  while (stack.length) {
    for (const entry of readdirSync(stack.pop(), { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(join(abs, entry.name));
      else if (entry.name.endsWith(".html")) return true;
    }
  }
  return false;
}

/** One criterion's argv: `verify <folder> [--flag value]…`, nothing else. */
function checkArgv(argv, task, knownFlags) {
  const errors = [];
  const label = `task "${task.id}" criterion "${task.__currentCriterionId}"`;
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((t) => typeof t !== "string" || !TOKEN_PATTERN.test(t))) {
    errors.push(`${label}: argv must be a non-empty array of shell-safe strings (no metacharacters)`);
    return errors;
  }
  if (argv[0] !== "verify") errors.push(`${label}: argv[0] must be the verify command (diff/fix/history exit codes are verdicts only in verify)`);
  if (argv[1] !== WORKSPACE_FOLDER) errors.push(`${label}: argv[1] must be the workspace folder "${WORKSPACE_FOLDER}", got ${JSON.stringify(argv[1])}`);
  if (!argv.includes("--fail-on")) errors.push(`${label}: a criterion must gate on an explicit --fail-on level, never on an inherited default`);
  const seeded = new Set((task.seeds ?? []).map((s) => s.file));
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag.startsWith("--")) {
      errors.push(`${label}: unexpected positional argument ${JSON.stringify(flag)}`);
      break;
    }
    if (!ALLOWED_FLAGS.includes(flag)) {
      errors.push(`${label}: flag ${flag} is not allowed in a criterion (allowed: ${ALLOWED_FLAGS.join(", ")})`);
      continue;
    }
    if (!knownFlags.has(flag)) errors.push(`${label}: flag ${flag} is not a real seaworthy CLI flag`);
    if (value === undefined || value.startsWith("-")) {
      errors.push(`${label}: ${flag} needs a value`);
      break;
    }
    if (flag === "--fail-on" && !FAIL_ON_LEVELS.includes(value)) errors.push(`${label}: --fail-on ${JSON.stringify(value)} cannot decide a criterion (use ${FAIL_ON_LEVELS.join(", ")})`);
    if (flag === "--base" && !value.startsWith("/")) errors.push(`${label}: --base must be a deployed path starting with "/"`);
    if (flag === "--baseline") {
      if (!FILE_NAME_PATTERN.test(value)) errors.push(`${label}: --baseline must name a file at the workspace root, got ${JSON.stringify(value)}`);
      else if (!seeded.has(value)) errors.push(`${label}: --baseline ${value} is not one of the task's seed files`);
    }
  }
  if (argv.length % 2 !== 0) errors.push(`${label}: every flag in argv must carry exactly one value`);
  return errors;
}

/** Every static rule of the task file; pure, so the unit tests can feed it fake data. */
export function validateTasks(data, { knownCheckIds, knownFlags, defaultFolders, pathExists = repoPathExists } = {}) {
  const errors = [];
  if (!data || typeof data !== "object" || !Array.isArray(data.tasks)) {
    return ["tasks file must be an object with a tasks array"];
  }
  if (data.version !== 0) errors.push(`version must be 0, got ${JSON.stringify(data.version)}`);
  if (defaultFolders && !defaultFolders.includes(WORKSPACE_FOLDER)) {
    errors.push(`workspace folder "${WORKSPACE_FOLDER}" is no longer a default built folder (${defaultFolders.join(", ")}); update this tool, the data, and the README together`);
  }
  if (data.tasks.length !== TASK_COUNT) errors.push(`the suite must hold exactly ${TASK_COUNT} tasks, got ${data.tasks.length}`);

  const seenIds = new Set();
  for (const [index, task] of data.tasks.entries()) {
    const where = `task ${index}`;
    if (!task || typeof task !== "object" || typeof task.id !== "string") {
      errors.push(`${where}: must be an object with an id`);
      continue;
    }
    const label = `task "${task.id}"`;
    if (!ID_PATTERN.test(task.id)) errors.push(`${where}: id must match ${ID_PATTERN}`);
    if (seenIds.has(task.id)) errors.push(`${label}: duplicate task id`);
    seenIds.add(task.id);
    for (const field of ["title", "prompt"]) {
      if (typeof task[field] !== "string" || task[field].trim().length === 0) errors.push(`${label}: ${field} must be a non-empty string`);
    }
    if (typeof task.start !== "string" || !task.start.startsWith("fixtures/")) errors.push(`${label}: start must be a fixtures/ path (built sites with ground truth)`);
    else if (!pathExists(task.start)) errors.push(`${label}: start ${task.start} does not exist in the repository`);
    else if (!hasHtml(task.start)) errors.push(`${label}: start ${task.start} contains no built HTML to verify`);
    const reference = task.reference ?? "fixtures/clean/minimal/site";
    if (typeof reference !== "string" || !pathExists(reference)) errors.push(`${label}: reference ${JSON.stringify(reference)} does not exist in the repository`);
    for (const seed of task.seeds ?? []) {
      if (!seed || typeof seed.file !== "string" || !FILE_NAME_PATTERN.test(seed.file)) errors.push(`${label}: seed file must be a plain workspace-root file name`);
      else if (seed.file === WORKSPACE_FOLDER) errors.push(`${label}: seed file must not collide with the ${WORKSPACE_FOLDER} folder`);
      if (typeof seed?.from !== "string" || !pathExists(seed.from)) errors.push(`${label}: seed source ${JSON.stringify(seed?.from)} does not exist`);
    }

    if (!Array.isArray(task.criteria) || task.criteria.length < 1 || task.criteria.length > 4) {
      errors.push(`${label}: needs 1..4 criteria`);
      continue;
    }
    const seenCriteria = new Set();
    for (const criterion of task.criteria) {
      task.__currentCriterionId = criterion?.id;
      if (!criterion || typeof criterion.id !== "string" || !ID_PATTERN.test(criterion.id)) {
        errors.push(`${label}: every criterion needs an id matching ${ID_PATTERN}`);
        continue;
      }
      if (seenCriteria.has(criterion.id)) errors.push(`${label}: duplicate criterion id "${criterion.id}"`);
      seenCriteria.add(criterion.id);
      errors.push(...checkArgv(criterion.argv, task, knownFlags ?? new Set(ALLOWED_FLAGS)));
      if (!KNOWN_EXIT_CODES.includes(criterion.expect_exit)) errors.push(`${label} "${criterion.id}": expect_exit must be one of ${KNOWN_EXIT_CODES.join("/")}`);
      if (!Array.isArray(criterion.proves) || criterion.proves.length === 0) errors.push(`${label} "${criterion.id}": proves must name at least one check ID`);
      else if (knownCheckIds) {
        for (const id of criterion.proves) if (!knownCheckIds.has(id)) errors.push(`${label} "${criterion.id}": proves names a check that does not exist: ${id}`);
      }
    }
    delete task.__currentCriterionId;
  }
  return errors;
}

/** The real CLI's flags, default folders, and check IDs, read from the built package. */
export async function cliContracts() {
  const optionPath = join(root, "packages/verify/dist/src/cli/options/index.js");
  const registryPath = join(root, "packages/verify/dist/src/checks/registry.js");
  const foldersPath = join(root, "packages/verify/dist/src/folders.js");
  if (!existsSync(optionPath) || !existsSync(registryPath) || !existsSync(foldersPath)) {
    throw new Error(`${TASKS_FILE}: build the CLI first (npm run build) — the validator reads its flags and check IDs from packages/verify/dist`);
  }
  const [{ OPTION_GROUPS }, { builtInChecks }, { DEFAULT_FOLDERS }] = await Promise.all([
    import(pathToFileURL(optionPath).href),
    import(pathToFileURL(registryPath).href),
    import(pathToFileURL(foldersPath).href),
  ]);
  const knownFlags = new Set(OPTION_GROUPS.flatMap((group) => [...group.flags]));
  const knownCheckIds = new Set(builtInChecks.map((check) => check.meta.id));
  return { knownFlags, knownCheckIds, defaultFolders: [...DEFAULT_FOLDERS] };
}

function buildWorkspace(task, siteSource) {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-bench-"));
  cpSync(join(root, siteSource), join(dir, WORKSPACE_FOLDER), { recursive: true });
  for (const seed of task.seeds ?? []) cpSync(join(root, seed.from), join(dir, seed.file));
  return dir;
}

/** Runs one criterion's argv from the workspace root; returns the exit code. */
export function runCriterion(argv, cwd) {
  const cli = join(root, "packages/verify/dist/src/cli.js");
  const result = spawnSync(process.execPath, [cli, ...argv], { cwd, encoding: "utf8" });
  if (result.error) throw new Error(`criterion ${JSON.stringify(argv)} could not run in ${cwd}: ${result.error.message}`);
  return result.status;
}

/**
 * Live check that every criterion is discriminating (fails on the untouched start) and
 * passable (succeeds on the reference site). Fully offline: flags outside
 * --fail-on/--base/--baseline cannot reach the network or a browser.
 */
export function dynamicCheck(data) {
  const errors = [];
  for (const task of data.tasks) {
    const reference = task.reference ?? "fixtures/clean/minimal/site";
    const dirs = [];
    try {
      const pre = buildWorkspace(task, task.start);
      const ref = buildWorkspace(task, reference);
      dirs.push(pre, ref);
      for (const criterion of task.criteria ?? []) {
        const label = `task "${task.id}" criterion "${criterion.id}"`;
        const preExit = runCriterion(criterion.argv, pre);
        if (preExit === criterion.expect_exit) errors.push(`${label}: already ${preExit === criterion.expect_exit ? "passes" : "matches"} on the untouched start (${JSON.stringify(criterion.argv)}) — the criterion proves nothing`);
        const refExit = runCriterion(criterion.argv, ref);
        if (refExit !== criterion.expect_exit) errors.push(`${label}: ${JSON.stringify(criterion.argv)} exits ${refExit} on reference ${reference}, expected ${criterion.expect_exit} — the criterion is not passable`);
      }
    } finally {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    }
  }
  return errors;
}

export function loadTasks(file = join(root, TASKS_FILE)) {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function main() {
  const { values } = parseArgs({ options: { quick: { type: "boolean", default: false } }, strict: true });
  let data;
  try {
    data = loadTasks();
  } catch (error) {
    console.error(`bench tasks: cannot read ${TASKS_FILE}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const contracts = await cliContracts();
  const errors = validateTasks(data, contracts);
  const dynamic = values.quick ? [] : dynamicCheck(data);
  errors.push(...dynamic);
  if (errors.length) {
    console.error(errors.map((e) => `bench tasks: ${e}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  const criteria = data.tasks.reduce((sum, task) => sum + task.criteria.length, 0);
  const seeds = data.tasks.reduce((sum, task) => sum + (task.seeds?.length ?? 0), 0);
  const runs = values.quick ? 0 : criteria * 2;
  console.log(`OK: bench tasks (${data.tasks.length} tasks, ${criteria} criteria, ${seeds} seeds${values.quick ? ", static only" : `, ${runs} offline CLI runs`})`);
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
