import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EXIT, run } from "../src/cli.js";
import { fingerprint } from "../src/engine.js";
import { appendHistory, buildHistoryRecord, HISTORY_DIR, HISTORY_KEEP, HISTORY_SPEC_VERSION, runConfigHash, stableStringify } from "../src/history.js";
import { buildReport } from "../src/report.js";
import type { Check, Finding, Severity } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = '<!doctype html><title>t</title><img src="a.png">';
const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) => [...ctx.site.pages.values()].filter((p) => p.source.includes("<img src=")).map((p) => ({ message: "no alt", location: { file: p.file, line: 1 }, fix: { kind: "manual" as const, summary: "add alt" }, key: p.url })),
};

const finding = (checkId: string, severity: Severity, file: string, line: number, key: string): Finding => ({
  checkId,
  severity,
  message: "m",
  location: { file, line },
  fix: { kind: "manual", summary: "s", edits: [], appliesTo: "built-output" },
  fingerprint: fingerprint(checkId, file, key),
});

const report = buildReport({
  root: "dist",
  pages: 3,
  checks: [],
  findings: [finding("images.alt", "error", "a.html", 1, "/a.png"), finding("links.internal", "warning", "b.html", 3, "/x"), finding("links.internal", "warning", "b.html", 9, "/x"), finding("can.quality", "note", "c.html", 2, "/c")],
});

const recordAt = (started: string) => buildHistoryRecord(report, { started, configHash: "a".repeat(64) });
const store = (cwd: string): string[] =>
  readdirSync(join(cwd, HISTORY_DIR)).filter((name) => STORE_FILE.test(name)).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
const seed = (cwd: string, name: string, content: string): void => {
  mkdirSync(join(cwd, HISTORY_DIR), { recursive: true });
  writeFileSync(join(cwd, HISTORY_DIR, name), content);
};
const STORE_FILE = /^\d{4,}-\d{8}T\d{9}Z\.json$/;

test("a record counts every finding by severity and by check", () => {
  const record = recordAt("2026-03-18T10:15:00.123Z");
  assert.deepEqual([record.spec, record.tool, record.root, record.pages, record.configHash.length], [HISTORY_SPEC_VERSION, "seaworthy", "dist", 3, 64]);
  assert.deepEqual(record.counts, { findings: 4, bySeverity: { error: 1, warning: 2, note: 1 }, byCheck: { "can.quality": 1, "images.alt": 1, "links.internal": 2 }, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0 });
});

test("a record is deterministic: sorted keys, no input-order effect, newline at the end", () => {
  const text = stableStringify(recordAt("2026-03-18T10:15:00.123Z"));
  assert.ok(text.endsWith("}\n"));
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), Object.keys(parsed).sort(), "top-level keys are sorted");
  assert.deepEqual(Object.keys(parsed.counts as Record<string, unknown>), Object.keys(parsed.counts as Record<string, unknown>).sort(), "nested keys are sorted too");
  assert.equal(stableStringify(recordAt("2026-03-18T10:15:00.123Z")), text, "the same run gives the same bytes");
});

test("the run config hash is a stable sha256 of the settings", () => {
  assert.match(runConfigHash({ a: 1 }), /^[0-9a-f]{64}$/);
  assert.equal(runConfigHash({ a: 1, b: { x: 2 } }), runConfigHash({ b: { x: 2 }, a: 1 }), "key order does not matter");
  assert.notEqual(runConfigHash({ a: 1 }), runConfigHash({ a: 2 }), "a changed setting changes the hash");
  assert.notEqual(runConfigHash({ checks: {} }), runConfigHash({ checks: { "images.alt": "warning" } }), "a severity override changes the hash");
});

test("a run is recorded as one file named <n>-<timestamp>.json that round-trips", () => {
  const cwd = makeSite({ "a.txt": "x" });
  const path = appendHistory(cwd, recordAt("2026-03-18T10:15:00.123Z"));
  assert.ok(path.startsWith(cwd), "the path is inside the folder verify ran in");
  const name = path.slice(cwd.length + 1 + HISTORY_DIR.length + 1);
  assert.equal(name, "0001-20260318T101500123Z.json", "the run number orders the runs, the timestamp explains them");
  assert.equal(readFileSync(path, "utf8"), stableStringify(recordAt("2026-03-18T10:15:00.123Z")), "sorted keys, two-space indent, newline at the end");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), recordAt("2026-03-18T10:15:00.123Z"));
  assert.equal(STORE_FILE.test(name), true, "the store consists exactly of the files it orders");
});

test("the newest run wins the next number, even when two runs share a timestamp", () => {
  const cwd = makeSite({ "a.txt": "x" });
  appendHistory(cwd, recordAt("2026-03-18T10:15:00.123Z"));
  appendHistory(cwd, recordAt("2026-03-18T10:15:00.123Z"));
  const written = appendHistory(cwd, recordAt("2026-03-18T10:15:00.123Z"));
  assert.deepEqual(store(cwd), ["0001-20260318T101500123Z.json", "0002-20260318T101500123Z.json", "0003-20260318T101500123Z.json"]);
  assert.equal(JSON.parse(readFileSync(written, "utf8")).spec, HISTORY_SPEC_VERSION);
});

test("the default keep is the documented bounded cap", () => {
  assert.equal(HISTORY_KEEP, 30);
});

test("pruning keeps the most recent runs and removes the oldest first", () => {
  const cwd = makeSite({ "a.txt": "x" });
  for (let i = 1; i <= 4; i++) seed(cwd, `000${i}-2026030${i}T000000000Z.json`, "{}\n");
  const written = appendHistory(cwd, recordAt("2026-03-05T00:00:00.000Z"), 3);
  assert.equal(written, join(cwd, HISTORY_DIR, "0005-20260305T000000000Z.json"));
  assert.deepEqual(store(cwd).map((name) => Number.parseInt(name, 10)), [3, 4, 5], "0001 and 0002 are pruned, the newest are kept");
  appendHistory(cwd, recordAt("2026-03-06T00:00:00.000Z"), 3);
  assert.deepEqual(store(cwd).map((name) => Number.parseInt(name, 10)), [4, 5, 6], "each prune drops exactly the oldest");
  assert.equal(existsSync(join(cwd, HISTORY_DIR, "0003-20260301T000000000Z.json")), false);
});

test("nothing is pruned until the cap is reached", () => {
  const cwd = makeSite({ "a.txt": "x" });
  seed(cwd, "0001-20260301T000000000Z.json", "{}\n");
  seed(cwd, "0002-20260302T000000000Z.json", "{}\n");
  appendHistory(cwd, recordAt("2026-03-03T00:00:00.000Z"));
  assert.deepEqual(store(cwd).map((name) => Number.parseInt(name, 10)), [1, 2, 3], "under the cap of 30, old runs stay");
});

test("a partial write does not corrupt the store: the next run survives and a truncated file is pruned like any other", () => {
  // A crash mid-write leaves a truncated record, and possibly its own .tmp, behind.
  const cwd = makeSite({ "a.txt": "x" });
  seed(cwd, "0001-20260301T000000000Z.json", '{"spec":1,"tool":"seawor');
  seed(cwd, ".0001-20260301T000000000Z.json.tmp", '{"spec":1,');
  const first = appendHistory(cwd, recordAt("2026-03-02T00:00:00.000Z"), 2);
  assert.deepEqual(JSON.parse(readFileSync(first, "utf8")), recordAt("2026-03-02T00:00:00.000Z"), "the next run writes a complete, parseable record");
  appendHistory(cwd, recordAt("2026-03-03T00:00:00.000Z"), 2);
  for (const name of store(cwd)) assert.deepEqual(JSON.parse(readFileSync(join(cwd, HISTORY_DIR, name), "utf8")).spec, HISTORY_SPEC_VERSION, `${name} is whole`);
  assert.deepEqual(store(cwd).map((name) => Number.parseInt(name, 10)), [2, 3], "the truncated file was pruned as the oldest");
  assert.equal(existsSync(join(cwd, HISTORY_DIR, ".0001-20260301T000000000Z.json.tmp")), true, "a .tmp outside the store is left alone, and the store never opens it");
});

test("verify records one history entry per run, without touching the output", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const result = await run(["verify", "dist", "--format", "json"], { cwd, checks: [imgCheck] });
  assert.equal(result.code, EXIT.findings);
  assert.equal(result.stderr, "", "recording a run is silent");
  const names = store(cwd);
  assert.equal(names.length, 1);
  assert.equal(STORE_FILE.test(names[0] as string), true);
  const record = JSON.parse(readFileSync(join(cwd, HISTORY_DIR, names[0] as string), "utf8"));
  assert.deepEqual(Object.keys(record), Object.keys(record).sort());
  assert.deepEqual([record.root, record.pages, record.counts.findings], ["dist", 1, 1]);
  assert.deepEqual(record.counts.bySeverity, { error: 1 });
  assert.deepEqual(record.counts.byCheck, { "images.alt": 1 });
  assert.match(record.started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(record.configHash, /^[0-9a-f]{64}$/);
});

test("the CLI keeps only the most recent runs, pruning the oldest first", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const args = ["verify", "dist", "--format", "json"];
  for (let i = 0; i < HISTORY_KEEP + 1; i++) await run(args, { cwd, checks: [imgCheck] });
  const names = store(cwd);
  assert.equal(names.length, HISTORY_KEEP, "the cap holds");
  for (let i = 1; i < names.length; i++) assert.ok(Number.parseInt(names[i] as string, 10) > Number.parseInt(names[i - 1] as string, 10), "runs stay in order, oldest first");
});

test("--no-history and the config opt out; the flag beats the config", async () => {
  const off = makeSite({ "dist/index.html": PAGE });
  const result = await run(["verify", "dist", "--no-history"], { cwd: off, checks: [imgCheck] });
  assert.equal(result.code, EXIT.findings);
  assert.equal(existsSync(join(off, HISTORY_DIR)), false, "no .seaworthy at all when history is off for the run");

  const config = makeSite({ "dist/index.html": PAGE, "seaworthy.config.json": JSON.stringify({ history: false }) });
  await run(["verify", "dist"], { cwd: config, checks: [imgCheck] });
  assert.equal(existsSync(join(config, HISTORY_DIR)), false, "history: false in the config is the opt-out");

  const beat = makeSite({ "dist/index.html": PAGE, "seaworthy.config.json": JSON.stringify({ history: true }) });
  await run(["verify", "dist", "--no-history"], { cwd: beat, checks: [imgCheck] });
  assert.equal(existsSync(join(beat, HISTORY_DIR)), false, "the flag wins over the config");
});

test("machine-readable output is byte-identical with and without history", async () => {
  const args = ["verify", "dist", "--format", "json"];
  const withHistory = makeSite({ "dist/index.html": PAGE, "dist/about.html": PAGE });
  const without = makeSite({ "dist/index.html": PAGE, "dist/about.html": PAGE });
  const on = await run(args, { cwd: withHistory, checks: [imgCheck] });
  const off = await run([...args, "--no-history"], { cwd: without, checks: [imgCheck] });
  assert.equal(on.stdout, off.stdout, "the JSON report is unchanged");
  assert.equal(on.code, off.code);
  assert.equal(on.stderr, off.stderr);
  assert.equal(store(withHistory).length, 1, "history was written on side one");
  assert.equal(existsSync(join(without, HISTORY_DIR)), false, "and not on side two");
});

test("a --changed run is recorded, and --update-baseline runs are not", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "dist/b.html": PAGE });
  const changed = await run(["verify", "dist", "--changed", "--format", "json"], { cwd, checks: [imgCheck] });
  assert.equal(changed.code, EXIT.findings);
  const record = JSON.parse(readFileSync(join(cwd, HISTORY_DIR, store(cwd)[0] as string), "utf8"));
  assert.equal(record.counts.changedFiles, 2, "the changed-file count travels into the record");

  const baselined = makeSite({ "dist/index.html": PAGE });
  await run(["verify", "dist", "--update-baseline", "b.json"], { cwd: baselined, checks: [imgCheck] });
  assert.equal(existsSync(join(baselined, HISTORY_DIR)), false, "writing a baseline is a setup step, not a comparable run");
  await run(["verify", "dist"], { cwd: baselined, checks: [imgCheck] });
  assert.deepEqual(store(baselined).map((n) => Number.parseInt(n, 10)), [1], "the first plain verify run starts the store");
});
