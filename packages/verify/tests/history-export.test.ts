// Issue #376: `readHistory` (the store reader the trends chain builds on) and
// `seaworthy history [--format csv|json] [--out <file>]`, the CSV/JSON export.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EXIT, run } from "../src/cli.js";
import { appendHistory, HISTORY_DIR, readHistory, type HistoryRecord } from "../src/history.js";
import { historyToCsv } from "../src/cli/history.js";
import { makeSite } from "./helpers.js";

/** A complete record with the given timestamp, root and counts; the writer needs the real shape. */
function record(started: string, root: string, counts: Partial<HistoryRecord["counts"]>): HistoryRecord {
  return {
    spec: 1,
    tool: "seaworthy",
    started,
    root,
    pages: 1,
    configHash: "f".repeat(64),
    counts: { findings: 0, bySeverity: {}, byCheck: {}, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0, ...counts },
  };
}

/** Seed the store directly, the way history.test.ts does, so a test controls every byte on disk. */
function seed(cwd: string, name: string, content: string): void {
  mkdirSync(join(cwd, HISTORY_DIR), { recursive: true });
  writeFileSync(join(cwd, HISTORY_DIR, name), content);
}

test("readHistory returns the stored runs oldest first", () => {
  const cwd = makeSite({});
  appendHistory(cwd, record("2026-03-01T00:00:00.000Z", "dist", { findings: 2 }));
  appendHistory(cwd, record("2026-03-02T00:00:00.000Z", "dist", { findings: 1 }));
  const runs = readHistory(cwd);
  assert.deepEqual(runs.map((r) => r.started), ["2026-03-01T00:00:00.000Z", "2026-03-02T00:00:00.000Z"]);
  assert.deepEqual(runs.map((r) => r.counts.findings), [2, 1]);
});

test("a missing or empty store reads as no runs, and reading never writes", async () => {
  const missing = makeSite({});
  assert.deepEqual(readHistory(missing), []);
  const empty = makeSite({});
  mkdirSync(join(empty, HISTORY_DIR), { recursive: true });
  assert.deepEqual(readHistory(empty), []);
  // `seaworthy history` in a folder that never verified: exit 0, an empty JSON array, no .seaworthy created.
  const result = await run(["history"], { cwd: missing });
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stdout, "[]\n");
  assert.equal(result.stderr, "");
  assert.equal(existsSync(join(missing, ".seaworthy")), false, "the command creates nothing");
});

test("a corrupt store is skipped, not crashed on", async () => {
  const cwd = makeSite({});
  appendHistory(cwd, record("2026-03-01T00:00:00.000Z", "dist", { findings: 3 }));
  appendHistory(cwd, record("2026-03-03T00:00:00.000Z", "dist", { findings: 1 }));
  // A truncated write, an empty JSON object, foreign bytes, and a leftover .tmp all sit in the store.
  seed(cwd, "0003-20260302T000000000Z.json", '{"spec":1,"tool":"seawor');
  seed(cwd, "0004-20260302T000000001Z.json", "{}\n");
  seed(cwd, "0005-20260302T000000002Z.json", "not json at all\n");
  seed(cwd, ".0006-20260302T000000003Z.json.tmp", '{"spec":1,');
  assert.deepEqual(readHistory(cwd).map((r) => r.started), ["2026-03-01T00:00:00.000Z", "2026-03-03T00:00:00.000Z"]);
  const json = await run(["history"], { cwd });
  assert.equal(json.code, EXIT.ok, "the json export survives a damaged store");
  assert.equal((JSON.parse(json.stdout) as HistoryRecord[]).length, 2);
  const csv = await run(["history", "--format", "csv"], { cwd });
  assert.equal(csv.code, EXIT.ok, "the csv export survives a damaged store");
  assert.equal(csv.stdout.split("\n").filter((line) => line !== "").length, 3, "header plus the two intact runs");
});

test("csv puts the fixed columns first, then one sorted check:<id> column per check in the store", () => {
  const rows = historyToCsv([
    record("2026-03-01T00:00:00.000Z", "dist", {
      findings: 3,
      bySeverity: { error: 1, warning: 2 },
      byCheck: { "links.internal": 2, "images.alt": 1 },
      errors: 0,
    }),
    record("2026-03-02T00:00:00.000Z", "site", { findings: 1, bySeverity: { note: 1 }, byCheck: { "can.quality": 1 } }),
  ]);
  const lines = rows.split("\n");
  assert.equal(lines[0], "runAt,root,findings,errors,warnings,notes,check:can.quality,check:images.alt,check:links.internal");
  // A count the run does not carry is an empty cell, never an invented zero: run 1 has no note,
  // run 2 no error or warning and neither images.alt nor links.internal.
  assert.equal(lines[1], "2026-03-01T00:00:00.000Z,dist,3,1,2,,,1,2");
  assert.equal(lines[2], "2026-03-02T00:00:00.000Z,site,1,,,1,1,,");
  assert.equal(rows.endsWith("\n"), true, "the file ends in one newline");
  assert.equal(rows.includes("\r"), false, "\\n line endings only");
  assert.equal(rows.charCodeAt(0), "r".charCodeAt(0), "no BOM");
});

test("csv quotes only what needs it, per RFC-4180", () => {
  const rows = historyToCsv([record("2026-03-01T00:00:00.000Z", 'my,dist "x"', { findings: 1, byCheck: { "a,b": 1 } })]);
  const lines = rows.split("\n");
  assert.equal(lines[0], 'runAt,root,findings,errors,warnings,notes,"check:a,b"');
  assert.equal(lines[1], '2026-03-01T00:00:00.000Z,"my,dist ""x""",1,,,,1');
});

test("the default format is json: the stored records, oldest first, keys exactly as on disk", async () => {
  const cwd = makeSite({});
  appendHistory(cwd, record("2026-03-01T00:00:00.000Z", "dist", { findings: 2, bySeverity: { error: 2 }, byCheck: { "images.alt": 2 } }));
  appendHistory(cwd, record("2026-03-02T00:00:00.000Z", "dist", { findings: 1, bySeverity: { warning: 1 }, byCheck: { "links.internal": 1 } }));
  const result = await run(["history"], { cwd });
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout) as HistoryRecord[];
  assert.deepEqual(parsed.map((r) => r.started), ["2026-03-01T00:00:00.000Z", "2026-03-02T00:00:00.000Z"]);
  const keys = Object.keys(parsed[0] as unknown as Record<string, unknown>);
  assert.deepEqual(keys, [...keys].sort(), "keys are in the fixed sorted order");
  assert.equal(parsed[0]?.started, "2026-03-01T00:00:00.000Z", "timestamps are the ISO strings already stored");
});

test("json export is byte-identical across two runs", async () => {
  const cwd = makeSite({});
  appendHistory(cwd, record("2026-03-01T00:00:00.000Z", "dist", { findings: 1 }));
  const first = await run(["history", "--format", "json"], { cwd });
  const second = await run(["history", "--format", "json"], { cwd });
  assert.equal(first.stdout, second.stdout);
});

test("--format csv with --out writes the file and prints a one-line summary; the store stays untouched", async () => {
  const cwd = makeSite({});
  appendHistory(cwd, record("2026-03-01T00:00:00.000Z", "dist", { findings: 1, bySeverity: { error: 1 }, byCheck: { "images.alt": 1 } }));
  const before = readFileSync(join(cwd, HISTORY_DIR, "0001-20260301T000000000Z.json"), "utf8");
  const result = await run(["history", "--format", "csv", "--out", "exports/history.csv"], { cwd });
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stdout, "seaworthy: 1 run; csv history written to exports/history.csv\n");
  assert.equal(readFileSync(join(cwd, "exports/history.csv"), "utf8"), historyToCsv(readHistory(cwd)));
  assert.equal(readFileSync(join(cwd, HISTORY_DIR, "0001-20260301T000000000Z.json"), "utf8"), before, "reading the store never writes it");
});

test("an empty store exports csv as just the header, and --out says so", async () => {
  const cwd = makeSite({});
  mkdirSync(join(cwd, HISTORY_DIR), { recursive: true });
  const csv = await run(["history", "--format", "csv"], { cwd });
  assert.equal(csv.stdout, "runAt,root,findings,errors,warnings,notes\n");
  const result = await run(["history", "--out", "hist.json"], { cwd });
  assert.equal(result.stdout, "seaworthy: no runs recorded; json history written to hist.json\n");
});

test("--out overwrites an existing file, like verify --out", async () => {
  const cwd = makeSite({});
  appendHistory(cwd, record("2026-03-01T00:00:00.000Z", "dist", { findings: 1 }));
  writeFileSync(join(cwd, "hist.json"), "stale\n");
  const result = await run(["history", "--out", "hist.json"], { cwd });
  assert.equal(result.code, EXIT.ok);
  const fresh = await run(["history"], { cwd });
  assert.equal(readFileSync(join(cwd, "hist.json"), "utf8"), fresh.stdout, "the file holds exactly what stdout would have printed");
});

test("usage errors exit 2", async () => {
  const cwd = makeSite({});
  for (const args of [["history", "--format", "yaml"], ["history", "--nope"], ["history", "--out"], ["history", "somefolder"]]) {
    const result = await run(args, { cwd });
    assert.equal(result.code, EXIT.usage, args.join(" "));
    assert.match(result.stderr, /^seaworthy: /);
  }
});

test("a store file that does not match the store pattern is left alone by the reader and the export", async () => {
  const cwd = makeSite({});
  appendHistory(cwd, record("2026-03-01T00:00:00.000Z", "dist", { findings: 1 }));
  seed(cwd, "notes.txt", "not a record\n");
  const result = await run(["history"], { cwd });
  assert.equal(result.code, EXIT.ok);
  assert.equal((JSON.parse(result.stdout) as HistoryRecord[]).length, 1);
});
