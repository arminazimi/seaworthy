// The 1,000-page measurement of issue #125, minus the wall clock.
//
// `tools/bench-1000.mjs` answers "does a 1,000-page site verify inside 30 s?" on a real machine.
// That number cannot be asserted here: a suite run under load measures the runner, not the engine
// (the reasoning behind tools/check-startup.mjs applies to a 10 s run even more than to a 150 ms
// one). What IS deterministic, and what this file freezes, is everything the budget claim rests
// on: the seeded generator writes exactly 1,000 pages and the same 1,000 pages twice, the CLI
// counts every one of them, a per-page check lands one finding per page, and `--timings` emits
// the stage and check breakdown the benchmark reports.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// packages/verify/dist/tests/perf-1000.test.js -> the repository root is four levels up.
const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const TOOL = join(ROOT, "tools", "bench-1000.mjs");
const CLI = join(ROOT, "packages", "verify", "dist", "src", "cli.js");
const PAGES = 1000;

const made: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-perf1000-"));
  made.push(dir);
  return dir;
}
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Writes the benchmark's site into a fresh temp folder with the benchmark's own generator. */
function generate(): string {
  const out = scratch();
  const run = spawnSync(process.execPath, [TOOL, "--pages", String(PAGES), "--generate-only", "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, `the fixture generator exited ${run.status}: ${run.stderr}`);
  return join(out, "site");
}

/** Every HTML file in a built site, as a path relative to its root, sorted. */
function htmlFiles(root: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...htmlFiles(root, relative));
    else if (entry.name.endsWith(".html")) found.push(relative);
  }
  return found.sort();
}

/** A digest over the page paths and their bytes: the whole fixture, so equality means byte-identical. */
function digest(root: string): string {
  const hash = createHash("sha256");
  for (const file of htmlFiles(root)) hash.update(file).update("\0").update(readFileSync(join(root, file))).update("\0");
  return hash.digest("hex");
}

const siteDir = generate();
const twinDir = generate(); // the same seed, written again into a different folder

test("the 1,000-page fixture: exactly 1,000 HTML pages, and the same bytes on a second run", () => {
  const pages = htmlFiles(siteDir);
  assert.equal(pages.length, PAGES, "the generator writes index.html plus PAGES-1 /blog posts");
  assert.ok(pages.includes("index.html"));
  assert.ok(pages.includes("blog/00000.html"));
  assert.ok(pages.includes(`blog/${String(PAGES - 2).padStart(5, "0")}.html`));
  assert.ok(!pages.includes(`blog/${String(PAGES - 1).padStart(5, "0")}.html`), "no page beyond the requested count");

  assert.equal(digest(siteDir), digest(twinDir), "seed 20261102 must regenerate the site byte-for-byte");
});

test("verify counts every page of the 1,000-page site and emits its timing summary", () => {
  // The report JSON is well over a megabyte at this size.
  const run = spawnSync(
    process.execPath,
    [CLI, "verify", "site", "--format", "json", "--no-history", "--timings", "--max-findings", String(PAGES * 10)],
    { cwd: join(siteDir, ".."), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  // 1 = findings at or above the failing severity; the fixture carries findings on purpose,
  // because a clean site skips the report work a real 1,000-page site pays. 2 (usage) and 4
  // (engine crash) are what this assertion catches.
  assert.equal(run.status, 1, `the CLI exited ${run.status}: ${run.stderr}`);

  const report = JSON.parse(run.stdout) as { root: string; summary: { pages: number; findings: number }; findings: { checkId: string }[] };
  assert.equal(report.root, "site", "the report labels the folder as it was given");
  assert.equal(report.summary.pages, PAGES, "the report counts one entry per page of the site");

  // Every generated page omits <link rel="canonical">, so that check reports exactly one finding
  // per page: the per-page work is visible in the report, not just in the page count.
  const canonical = report.findings.filter((finding) => finding.checkId === "meta.canonical");
  assert.equal(canonical.length, PAGES, "meta.canonical reports one finding for every one of the 1,000 pages");

  const timings = run.stderr;
  assert.match(timings, /^seaworthy: timings$/m);
  assert.match(timings, /^\s{2}total \d+(\.\d+)? ms$/m);
  assert.match(timings, /^\s{2}stage site \d+(\.\d+)? ms$/m);
  assert.match(timings, /^\s{2}stage checks \d+(\.\d+)? ms$/m);
  assert.ok(/\n\s{2}check \S+ \d/.test(timings), "the per-check lines are part of the timing summary");
});
