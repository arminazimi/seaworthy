// Tests for the badge adapter (@seaworthy/action/src/badge.ts) and the seaworthy-badge CLI.
// The pure report-to-SVG function and its determinism are pinned in tools/brand/badge-report.test.mjs;
// these cover the adapter: module loading, snippet, file writing idempotence, and CLI behavior.

import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { badgeForReport, badgeModule, readmeSnippet, writeBadgeFile } from "../src/badge.js";
import { run } from "../src/badge-cli.js";

const SNIPPET =
  "[![seaworthy verified](https://raw.githubusercontent.com/OWNER/REPO/BRANCH/seaworthy-badge.svg)](https://github.com/arminazimi/seaworthy)";

const report = (error = 0, warning = 0): unknown => ({
  spec: 1,
  summary: { pages: 1, findings: error + warning, bySeverity: { ...(error > 0 ? { error } : {}), ...(warning > 0 ? { warning } : {})} },
  errors: [],
});

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "seaworthy-badge-"));
}

test("the adapter loads the brand module and agrees with it", async () => {
  const mod = await badgeModule();
  assert.equal(typeof mod.badgeForReport, "function");
  assert.equal(typeof mod.badgeSvg, "function");
  assert.equal(mod.README_SNIPPET, SNIPPET);
  assert.equal((await mod.badgeForReport(report(1))).state, "failing");
  assert.equal(await readmeSnippet(), SNIPPET);
  assert.equal((await badgeForReport(report(1))).state, "failing");
  assert.equal((await badgeForReport(report(0, 2))).state, "warnings");
  assert.equal((await badgeForReport(report())).state, "passing");
});

test("writeBadgeFile is idempotent across reruns", async () => {
  const svg = (await badgeForReport(report(0, 1))).svg;
  const dir = await tempDir();
  const out = join(dir, "nested", "seaworthy-badge.svg");
  assert.equal(await writeBadgeFile(svg, out), out);
  assert.equal(await readFile(out, "utf8"), svg);
  const before = (await stat(out)).mtimeMs;
  assert.equal(await writeBadgeFile(svg, out), out);
  assert.equal((await stat(out)).mtimeMs, before, "identical bytes leave the file untouched");
  await writeFile(out, "<svg>stale</svg>", "utf8");
  assert.equal(await writeBadgeFile(svg, out), out);
  assert.equal(await readFile(out, "utf8"), svg, "an actually different file is rewritten");
});

test("--readme prints the snippet verbatim, with no other output", async () => {
  const result = await run(["--readme"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${SNIPPET}\n`);
});

test("--help and --version exit 0 with text", async () => {
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage:\n  seaworthy-badge/);
  const version = await run(["--version"]);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^@seaworthy\/action \d+\.\d+\.\d+$/);
  assert.equal((await run(["-h"])).code, 0);
});

test("usage errors exit 2", async () => {
  assert.equal((await run(["--nope"])).code, 2);
  assert.equal((await run(["--out", "--report", "x"])).code, 2, "--out given no value");
  assert.equal((await run(["--report", "does/not/exist.json"])).code, 2);
});

test("stdin and --report both produce the same deterministic SVG; --out writes a file", async () => {
  const dir = await tempDir();
  const reportPath = join(dir, "report.json");
  await writeFile(reportPath, JSON.stringify(report(1, 2)), "utf8");
  const fromFile = await run(["--report", reportPath]);
  assert.equal(fromFile.code, 0);
  const fromStdin = await run([], { stdin: JSON.stringify(report(1, 2)) });
  assert.equal(fromStdin.code, 0);
  assert.equal(fromFile.stdout, fromStdin.stdout);
  assert.match(fromFile.stdout, /aria-label="seaworthy: 1 error"/);
  const out = join(dir, "badge.svg");
  const written = await run(["--report", reportPath, "--out", out]);
  assert.equal(written.code, 0);
  assert.equal(written.stdout, "");
  assert.equal(written.stderr, `${out}: failing (1)\n`);
  assert.equal(await readFile(out, "utf8"), fromFile.stdout);
});

test("exit 2 for a report that is not JSON, and for one the badge cannot read", async () => {
  const notJson = await run([], { stdin: "not json" });
  assert.equal(notJson.code, 2);
  assert.match(notJson.stderr, /stdin is not JSON/);
  assert.match(notJson.stderr, /Run `seaworthy-badge --help` for usage\./);
  const notAReport = await run([], { stdin: "[]" });
  assert.equal(notAReport.code, 2, "valid JSON that is not a report is still an error");
  assert.match(notAReport.stderr, /report must be the JSON object/);
  const bad = await run([], { stdin: JSON.stringify({ summary: { bySeverity: { error: -3 } } }) });
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /bySeverity\.error must be a whole number/);
  const passes = await run([], { stdin: JSON.stringify(report()) });
  assert.equal(passes.code, 0, "a failing badge is still exit 0: the write succeeded, the gate is verify's job");
  assert.match(passes.stdout, /aria-label="seaworthy: passing"/);
});
