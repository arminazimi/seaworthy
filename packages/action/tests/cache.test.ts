// Issue #261 (`action.cache-seaworthy`): what the Action keeps between runs, and what it refuses to
// read back. Two rules hold the feature up, and both are testable offline:
//
//   1. the cache key isolates the store completely — another ref, another config, another Action ref
//      means another key, and there are no restore-keys to blur that;
//   2. a store that arrives anyway is trusted only when its own fields fit this run: a record for a
//      different site folder, or written by a newer history spec, is deleted before the CLI reads it.
//
// Cache failures never change the verdict, so the exit codes asserted below are the CLI's own.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { HISTORY_DIR, HISTORY_SPEC_VERSION, appendHistory, readHistory, type HistoryRecord } from "@seaworthy/verify";

import {
  CACHE_KEY_PREFIX,
  cacheKeyFromEnv,
  historyCacheKey,
  historyStoreDir,
  recordDistrust,
  reviewRestoredHistory,
} from "../src/cache.js";
import { CACHE_KEY_OUTPUT, cacheKey, run } from "../src/cache-cli.js";
import { actionRun } from "../src/run.js";

const ENV = { os: "Linux", ref: "refs/heads/main", tool: "8f3a1c9", config: "" };
const KEY_CHARSET = /^[a-zA-Z0-9_-]+$/;

const made: string[] = [];
after(() => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `seaworthy-${prefix}-`));
  made.push(root);
  return root;
}

/** A record the way the history writer stores one, for the folder `root`. */
function recordOf(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    spec: HISTORY_SPEC_VERSION,
    tool: "seaworthy",
    started: "2026-03-01T10:15:00.123Z",
    root: "dist",
    pages: 1,
    configHash: "a".repeat(64),
    counts: { findings: 0, bySeverity: {}, byCheck: {}, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0 },
    ...over,
  };
}

/** One stored file, written straight into the store with a name the store recognises. */
function storeFile(cwd: string, name: string, record: unknown): string {
  const dir = historyStoreDir(cwd);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
  return path;
}

// ---- the cache key -------------------------------------------------------------------------------------------

test("the history key is a pure function of its parts: the same run always gets the same key", () => {
  assert.equal(historyCacheKey(ENV), historyCacheKey({ ...ENV }));
  assert.ok(historyCacheKey(ENV).startsWith(`${CACHE_KEY_PREFIX}-Linux-refs-heads-main-`));
  assert.match(historyCacheKey(ENV), KEY_CHARSET, "GitHub cache keys take alphanumeric characters, - and _ only");
  assert.ok(historyCacheKey(ENV).length <= 512);
});

test("the key isolates the branch: a pull request never restores main's history", () => {
  const main = historyCacheKey(ENV);
  assert.notEqual(main, historyCacheKey({ ...ENV, ref: "refs/heads/feature/new-header" }), "another branch is another store");
  assert.notEqual(main, historyCacheKey({ ...ENV, ref: "refs/pull/7/merge" }), "a pull request run is another store");
  assert.notEqual(historyCacheKey({ ...ENV, ref: "refs/pull/7/merge" }), historyCacheKey({ ...ENV, ref: "refs/pull/8/merge" }));
  assert.notEqual(main, historyCacheKey({ ...ENV, ref: "refs/tags/v0.2.0" }), "a tag run is another store");
});

test("the key isolates the configuration: editing the config starts a fresh store", () => {
  const base = historyCacheKey(ENV);
  const edited = historyCacheKey({ ...ENV, config: '{"checks":{"html.charset":"off"}}' });
  assert.notEqual(base, edited);
  assert.notEqual(edited, historyCacheKey({ ...ENV, config: '{"checks":{"html.charset":"on"}}' }), "a different setting, not just a different byte count");
  assert.ok(base.includes("no-config"), "a site with no config file says so in the key");
});

test("the key isolates the build that filled the store and the OS it ran on", () => {
  assert.notEqual(historyCacheKey(ENV), historyCacheKey({ ...ENV, tool: "v1-main" }), "another Action ref means another check set");
  assert.notEqual(historyCacheKey(ENV), historyCacheKey({ ...ENV, os: "Windows" }));
});

test("parts that fold to the same readable text still get different stores", () => {
  // Cache keys cannot contain `/`, so `feature/a` sanitizes to `feature-a`; without the digest of
  // the raw parts the two branches would share one history, which is the false-delta bug itself.
  assert.notEqual(historyCacheKey({ ...ENV, ref: "refs/heads/feature/a" }), historyCacheKey({ ...ENV, ref: "refs/heads/feature-a" }));
  assert.ok(historyCacheKey({ ...ENV, ref: "refs/heads/weird! name with (chars)" }).match(KEY_CHARSET));
  const long = historyCacheKey({ ...ENV, ref: `refs/heads/${"x".repeat(300)}` });
  assert.ok(long.length < 120, `the readable parts stay bounded, not the whole 512 (${long.length})`);
  assert.match(long, KEY_CHARSET);
});

test("no key, no cache: a run whose ref the runner did not say gets an empty key", () => {
  assert.equal(cacheKeyFromEnv({ RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main", SEAWORTHY_CACHE_TOOL: "8f3a1c9" }, ""), historyCacheKey(ENV));
  assert.equal(cacheKeyFromEnv({ RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main", GITHUB_ACTION_REF: "8f3a1c9" }, ""), historyCacheKey(ENV), "the runner's own variable is the fallback for the step env");
  assert.equal(cacheKeyFromEnv({ RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main" }, ""), historyCacheKey({ ...ENV, tool: "" }), "a `uses: ./` run has no Action ref, and says so in the key");
  assert.equal(cacheKeyFromEnv({ RUNNER_OS: "Linux", GITHUB_REF: "" }, ""), "", "no ref means no branch isolation");
  assert.equal(cacheKeyFromEnv({ GITHUB_REF: "refs/heads/main" }, ""), "", "no OS means a Linux store could answer a Windows run");
  assert.equal(cacheKeyFromEnv({}, ""), "");
});

// ---- the restored store -------------------------------------------------------------------------------------

test("a record for another site folder is not trusted", () => {
  assert.equal(recordDistrust(recordOf(), { root: "dist", spec: HISTORY_SPEC_VERSION }), undefined);
  assert.equal(recordDistrust(recordOf({ root: "build" }), { root: "dist", spec: HISTORY_SPEC_VERSION }), "recorded for build, this run verifies dist");
  // With no site input the folder is the CLI's to discover, so the folder check is the CLI's too;
  // its readers treat a record of another root as "no previous run" rather than as a baseline.
  assert.equal(recordDistrust(recordOf({ root: "build" }), { root: undefined, spec: HISTORY_SPEC_VERSION }), undefined);
});

test("a record written by a newer history spec is not trusted, an older one still is", () => {
  const newer = recordDistrust(recordOf({ spec: HISTORY_SPEC_VERSION + 1 }), { root: "dist", spec: HISTORY_SPEC_VERSION });
  assert.equal(newer, `recorded with spec ${HISTORY_SPEC_VERSION + 1}, this build reads up to ${HISTORY_SPEC_VERSION}`);
  assert.equal(recordDistrust(recordOf({ spec: 0 }), { root: "dist", spec: HISTORY_SPEC_VERSION }), undefined, "an older spec the readers still understand");
  assert.equal(recordDistrust(recordOf({ spec: "1" as unknown as number }), { root: "dist", spec: HISTORY_SPEC_VERSION }), "no spec version");
});

test("a file that is not a Seaworthy record is not trusted", () => {
  const expected = { root: "dist", spec: HISTORY_SPEC_VERSION };
  assert.match(recordDistrust({ tool: "someone-else", spec: 1 }, expected) ?? "", /not written by seaworthy/);
  assert.match(recordDistrust({ tool: "seaworthy" }, expected) ?? "", /no spec version/);
  assert.match(recordDistrust({ tool: "seaworthy", spec: 1, started: "2026-03-01T10:15:00.123Z" }, expected) ?? "", /names no site folder/);
  assert.match(recordDistrust({ tool: "seaworthy", spec: 1, root: "dist", started: "2026-03-01T10:15:00.123Z" }, expected) ?? "", /no finding counts/);
  assert.equal(recordDistrust(null, expected), "not a JSON object");
  assert.equal(recordDistrust("dist", expected), "not a JSON object");
});

test("the review keeps the trusted records and deletes the refused ones", () => {
  const cwd = tempDir("store");
  const trusted = storeFile(cwd, "0001-20260301T101500123Z.json", recordOf());
  const otherFolder = storeFile(cwd, "0002-20260302T101500123Z.json", recordOf({ root: "build" }));
  const future = storeFile(cwd, "0003-20260303T101500123Z.json", recordOf({ spec: HISTORY_SPEC_VERSION + 1 }));
  const broken = storeFile(cwd, "0004-20260304T101500123Z.json", "not json at all");
  const foreign = join(historyStoreDir(cwd), "notes.json");
  writeFileSync(foreign, "keep me, I am not a record");

  const review = reviewRestoredHistory(cwd, "dist");
  assert.equal(review.kept, 1);
  assert.deepEqual(review.dropped.map((d) => d.name).sort(), ["0002-20260302T101500123Z.json", "0003-20260303T101500123Z.json", "0004-20260304T101500123Z.json"]);
  assert.equal(existsSync(trusted), true, "the trusted record stays readable");
  for (const refused of [otherFolder, future, broken]) assert.equal(existsSync(refused), false, `${refused} must not survive the review`);
  assert.equal(existsSync(foreign), true, "a file the store never names is left alone");
  assert.deepEqual(readHistory(cwd).map((r) => r.root), ["dist"], "and the CLI reads exactly what the review kept");
});

test("a missing store is no history, not an error", () => {
  const cwd = tempDir("nostore");
  assert.deepEqual(reviewRestoredHistory(cwd, "dist"), { kept: 0, dropped: [] });
  // A store the run wrote itself stays: only the names the store uses are reviewed.
  appendHistory(cwd, recordOf({ root: "out" }));
  assert.deepEqual(reviewRestoredHistory(cwd, "dist"), { kept: 0, dropped: [{ name: "0001-20260301T101500123Z.json", reason: "recorded for out, this run verifies dist" }] });
  assert.equal(existsSync(join(cwd, HISTORY_DIR, "0001-20260301T101500123Z.json")), false);
});

// ---- the executable the composite calls ---------------------------------------------------------------------

test("cache key writes the step output and never fails the run", () => {
  const out = join(tempDir("output"), "github_output");
  writeFileSync(out, "");
  const result = run(["key"], { GITHUB_OUTPUT: out, RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main", SEAWORTHY_CACHE_TOOL: "8f3a1c9", GITHUB_WORKSPACE: tempDir("empty-site") });
  assert.equal(result.code, 0);
  assert.equal(result.key, historyCacheKey(ENV));
  assert.equal(readFileSync(out, "utf8"), `${CACHE_KEY_OUTPUT}=${historyCacheKey(ENV)}\n`);
});

test("an uncomputable key is silence, not a failure: no env, no exit code, no output line", () => {
  const out = join(tempDir("output"), "github_output");
  writeFileSync(out, "previous=kept\n");
  const result = run(["key"], { GITHUB_OUTPUT: out });
  assert.equal(result.code, 0, "a cache that cannot be keyed must not fail the verification");
  assert.equal(result.key, "");
  assert.match(result.stderr, /seaworthy: history cache disabled/);
  assert.equal(readFileSync(out, "utf8"), "previous=kept\n", "nothing is appended, so the guarded step skips");
});

test("the cache executable reads a workspace it cannot open as no config, and a bad command as usage", () => {
  // A workspace with an unreadable config is not a reason to fail: the CLI's own config load is what
  // reports that, and it runs before any cached state matters.
  assert.equal(cacheKey({ RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main" }, "/no/such/workspace"), historyCacheKey({ os: "Linux", ref: "refs/heads/main", tool: "", config: "" }));
  assert.equal(cacheKey({ RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main" }, tempDir("no-config")), historyCacheKey({ ...ENV, tool: "", config: "" }));
  const result = run(["save"], {});
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown command "save"/);
});

// ---- end to end, through the Action's own run --------------------------------------------------------------
// These spawn the built verify CLI the way action.yml does, so the cache path is proven to leave the
// verdict alone: the site's findings still decide the exit code, with a store refused or not.

const PAGE = '<!doctype html>\n<html lang="en"><head><title>Page</title><meta name="description" content="A description."></head>\n<body><main><h1>Heading</h1><p>Some text.</p></main></body></html>\n';

/** Turns off every check the page trips except the ones named, so the run has findings of a known severity only. */
function onlyChecks(...keep: string[]): string {
  const checks: Record<string, string> = {};
  for (const id of ["quality.not-found-page", "html.charset", "meta.canonical", "meta.viewport", "social.open-graph", "social.twitter-card", "readability.llms-txt"]) {
    if (!keep.includes(id)) checks[id] = "off";
  }
  return JSON.stringify({ checks });
}

const CLEAN = onlyChecks();

/** A consumer's checkout: a built site that passes, and a config next to it. */
function workspace(files: Record<string, string>): string {
  const root = tempDir("workspace");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...path.split("/")), content);
  }
  return root;
}

async function runAction(root: string, env: Record<string, string | undefined>): Promise<{ code: number; stdout: string }> {
  let stdout = "";
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await actionRun({ GITHUB_WORKSPACE: root, SEAWORTHY_SITE: "dist", SEAWORTHY_THRESHOLD: "error", ...env }), stdout };
  } finally {
    process.stdout.write = write;
  }
}

test("a refused restored record does not change the verdict, and is gone before the CLI runs", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": CLEAN });
  const refused = storeFile(root, "0001-20260301T101500123Z.json", recordOf({ root: "build" }));
  const { code, stdout } = await runAction(root, { SEAWORTHY_CACHE: "history" });
  assert.equal(code, 0, "the site is clean: the cache review cannot turn that into a failure");
  assert.equal(existsSync(refused), false);
  assert.match(stdout, /history cache: refused 1 restored record .*recorded for build, this run verifies dist/);
  assert.match(stdout, /seaworthy: 0 findings in dist/, "and the run reports the site, as it always did");
});

test("a restored store this run may read is reported, and the run writes its own record on top", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": CLEAN });
  const trusted = storeFile(root, "0001-20260301T101500123Z.json", recordOf());
  const { code, stdout } = await runAction(root, { SEAWORTHY_CACHE: "history" });
  assert.equal(code, 0);
  assert.equal(existsSync(trusted), true);
  assert.match(stdout, /history cache: 1 restored record trusted for their shape and their site folder \(dist\)/);
  assert.equal(readHistory(root).length, 2, "the restored run stays in the trend, the new run adds itself");
});

test("the review mixes neither: a refused record goes and the trusted one stays", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": CLEAN });
  const trusted = storeFile(root, "0001-20260301T101500123Z.json", recordOf());
  const refused = storeFile(root, "0002-20260302T101500123Z.json", recordOf({ spec: HISTORY_SPEC_VERSION + 1 }));
  const { code, stdout } = await runAction(root, { SEAWORTHY_CACHE: "history" });
  assert.equal(code, 0);
  assert.equal(existsSync(trusted), true);
  assert.equal(existsSync(refused), false);
  assert.match(stdout, /refused 1 restored record \(0002-20260302T101500123Z\.json: recorded with spec \d+, this build reads up to \d+\); the other 1 record stays as its history/);
});

test("with the cache off the Action touches no history at all", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": CLEAN });
  const otherFolder = storeFile(root, "0001-20260301T101500123Z.json", recordOf({ root: "build" }));
  const { code, stdout } = await runAction(root, {});
  assert.equal(code, 0);
  assert.equal(existsSync(otherFolder), true, "a store the workflow did not opt into caching is the workspace's own");
  assert.doesNotMatch(stdout, /history cache/);
});

test("the cache input never decides the outcome: a failing site fails the same with and without it", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": onlyChecks("html.charset") });
  assert.equal((await runAction(root, {})).code, 1, "off: the site's error fails the run");
  assert.equal((await runAction(root, { SEAWORTHY_CACHE: "history" })).code, 1, "history: the run's own record is kept, the site still fails it");
});

test("a store that is not a folder is a missed cache, not a failed run", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": CLEAN });
  mkdirSync(join(root, ".seaworthy"), { recursive: true });
  writeFileSync(join(root, HISTORY_DIR), "not a folder");
  const { code, stdout } = await runAction(root, { SEAWORTHY_CACHE: "history" });
  assert.equal(code, 0, "the review reads nothing, and the CLI's own failed history write is its own warning");
  assert.doesNotMatch(stdout, /history cache/, "no records, so nothing to report");
});

test("an unreadable config still keys the store: the key is a name, not a verdict", async () => {
  const root = workspace({ "dist/index.html": PAGE });
  mkdirSync(join(root, "seaworthy.config.json"), { recursive: true });
  const key = cacheKey({ RUNNER_OS: "Linux", GITHUB_REF: "refs/heads/main" }, root);
  assert.equal(key, historyCacheKey({ os: "Linux", ref: "refs/heads/main", tool: "", config: "" }), "a config that is a folder reads as no config here");
  assert.match(key, KEY_CHARSET);
});

// ---- the composite's own wiring ------------------------------------------------------------------------------
// `action.yml` is YAML and this repository depends on no YAML parser, so these assert on its text.
// They pin the two rules the code above cannot reach: which path the cache step is given, and that
// both cache steps only exist behind the input.

/** Walks up from this test's own folder to the repository file of that name. */
function repoFile(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`${name} not found above this test`);
}

const COMPOSITE = readFileSync(repoFile("action.yml"), "utf8");

test("the composite caches the history folder and nothing else", () => {
  const cacheSteps = COMPOSITE.split("\n").filter((line) => line.includes("uses: actions/cache"));
  assert.equal(cacheSteps.length, 1, "one cache step: it restores in its own run and saves in its post run");
  assert.match(cacheSteps[0] ?? "", /actions\/cache@v4/);
  const cachedPath = COMPOSITE.slice(COMPOSITE.indexOf("actions/cache@v4")).split("\n").find((line) => line.trim().startsWith("path:"))?.trim();
  assert.equal(cachedPath, "path: ${{ github.workspace }}/.seaworthy/history", "not the site, not cache.json, not node_modules");
  assert.doesNotMatch(COMPOSITE, /^\s*restore-keys:/m, "an approximate hit is another run's baseline");
});

test("the cache steps sit behind the input, and its default caches nothing", () => {
  assert.match(COMPOSITE, /default: "off"/, "quoted, or workflow YAML reads the default as boolean false");
  assert.equal(COMPOSITE.split("\n").filter((line) => line.trim().startsWith("if:") && line.includes("inputs.cache == 'history'")).length, 2, "the key step and the cache step, both behind the input");
  assert.match(COMPOSITE, /SEAWORTHY_CACHE: \$\{\{ inputs\.cache \}\}/, "the mode reaches run.js the way the other inputs do");
  const cacheKeyStep = COMPOSITE.indexOf("cache-cli.js");
  const verifyStep = COMPOSITE.indexOf("dist/run.js");
  assert.ok(cacheKeyStep !== -1 && cacheKeyStep < verifyStep, "the store is in the workspace before the CLI runs");
});
