// Issue #375 (`trends.pr-comment`): the PR comment gains the trend over the runs verify recorded
// in .seaworthy/history, and nothing else. The tests below read the store the way the Action does
// — from the workspace it verifies — and pin the body byte for byte.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  appendHistory,
  buildReport,
  diffReports,
  formatDiffComment,
  HISTORY_DIR,
  readHistory,
  readReport,
  reportToJson,
  type HistoryRecord,
} from "@seaworthy/verify";
import type { Finding } from "@seaworthy/verify";

import { COMMENT_FILE, EXIT, commentBody, run } from "../src/pr-comment.js";
import { TREND_RUNS, comparableRuns, trendLines, withTrend } from "../src/trend.js";

const missingAlt: Finding = {
  checkId: "images.alt",
  severity: "warning",
  message: '<img src="/a.png"> has no alt attribute.',
  location: { file: "docs/link.html", line: 5 },
  fix: { kind: "edit", summary: "Add alt text.", edits: [], appliesTo: "built-output" },
  fingerprint: "bbbbbbbb22222222",
};
const noCharset: Finding = {
  checkId: "html.charset",
  severity: "error",
  message: "No character encoding is declared.",
  location: { file: "a.html", line: 1 },
  fix: { kind: "edit", summary: "Declare a charset in the head.", edits: [], appliesTo: "built-output" },
  fingerprint: "dddddddd44444444",
};

/** The body as it reads with no history in the workspace: unchanged since issue #89. */
const BASE_BODY = `## Seaworthy: 0 new, 1 fixed

\`after\`: 2 findings before, 1 finding after, 1 unchanged.

**Fixed**

| Severity | Check | Location | Problem |
| --- | --- | --- | --- |
| error | \`html.charset\` | \`a.html:1\` | No character encoding is declared. |

<!-- seaworthy:pr-comment -->
`;

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

/** A stored run summary: the counts the trend renders, the rest as the writer would leave them. */
function record(started: string, configHash: string, counts: Partial<HistoryRecord["counts"]>): HistoryRecord {
  return {
    spec: 1,
    tool: "seaworthy",
    started,
    root: "dist",
    pages: 2,
    configHash,
    counts: { findings: 0, bySeverity: {}, byCheck: {}, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0, ...counts },
  };
}

const made: string[] = [];

/** A consumer's workspace: the two report files the comment body is built from, and nothing else. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-trend-"));
  made.push(dir);
  writeFileSync(join(dir, "before.json"), reportToJson(buildReport({ root: "before", pages: 2, checks: [], findings: [missingAlt, noCharset] })));
  writeFileSync(join(dir, "after.json"), reportToJson(buildReport({ root: "after", pages: 2, checks: [], findings: [missingAlt] })));
  return dir;
}

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Seeds the store the way verify's own history writer does, so the files on disk are real. */
function seedHistory(dir: string, records: readonly HistoryRecord[]): void {
  for (const record of records) appendHistory(dir, record);
}

/** Writes one extra file into the store by hand: the damaged or foreign record a real store can hold. */
function seedFile(dir: string, name: string, content: string): void {
  mkdirSync(join(dir, HISTORY_DIR), { recursive: true });
  writeFileSync(join(dir, HISTORY_DIR, name), content);
}

test("a workspace with no run history gets the comment body it got before trends, byte for byte", () => {
  const dir = workspace();
  assert.deepEqual(readHistory(dir), [], "the store is simply absent");
  const body = commentBody("before.json", "after.json", dir);
  assert.equal(body, BASE_BODY, "no history means no trend section, no extra blank line, no marker move");
  assert.doesNotMatch(body, /[Tt]rend/);
  // The same bytes the diff formatter itself produces: the Action adds nothing when it has nothing to add.
  const expected = formatDiffComment(diffReports(readReport(join(dir, "before.json")), readReport(join(dir, "after.json"))));
  assert.equal(body, expected);
});

test("one stored run is not a trend: the body stays as it is today", () => {
  const dir = workspace();
  seedHistory(dir, [record("2026-03-01T09:00:00.000Z", HASH, { findings: 12, bySeverity: { error: 2, warning: 7, note: 3 } })]);
  assert.equal(commentBody("before.json", "after.json", dir), BASE_BODY);
});

test("comparable runs add one severity table above the marker, oldest run first", () => {
  const dir = workspace();
  seedHistory(dir, [
    record("2026-03-01T09:00:00.000Z", HASH, { findings: 12, bySeverity: { error: 2, warning: 7, note: 3 } }),
    record("2026-03-02T09:00:00.000Z", HASH, { findings: 9, bySeverity: { error: 1, warning: 6, note: 2 } }),
    record("2026-03-03T09:00:00.000Z", HASH, { findings: 8, bySeverity: { error: 1, warning: 5, note: 2 } }),
  ]);
  const expected = `${BASE_BODY.replace("<!-- seaworthy:pr-comment -->\n", "")}**Trend over the last 3 comparable runs (same configuration), oldest first**

| Date | Findings | Errors | Warnings | Notes |
| --- | --- | --- | --- | --- |
| 2026-03-01 | 12 | 2 | 7 | 3 |
| 2026-03-02 | 9 | 1 | 6 | 2 |
| 2026-03-03 | 8 | 1 | 5 | 2 |

<!-- seaworthy:pr-comment -->
`;
  const body = commentBody("before.json", "after.json", dir);
  assert.equal(body, expected);
  assert.ok(body.endsWith("<!-- seaworthy:pr-comment -->\n"), "the marker still ends the body, so the Action finds its own comment");
  assert.equal(body, commentBody("before.json", "after.json", dir), "the same store builds the same bytes");
});

test("the date column is the UTC date part of the stored timestamp, never a local-time rendering", () => {
  // 23:45 UTC on the 1st is still the 1st: a local-time format would move it to the 2nd in +02:00.
  const rows = trendLines([
    record("2026-03-01T23:45:00.000Z", HASH, { findings: 2, bySeverity: { error: 2 } }),
    record("2026-03-02T23:45:00.000Z", HASH, { findings: 1, bySeverity: { error: 1 } }),
  ]);
  assert.deepEqual(rows.at(-3), "| 2026-03-01 | 2 | 2 | 0 | 0 |");
  assert.deepEqual(rows.at(-2), "| 2026-03-02 | 1 | 1 | 0 | 0 |");
});

test("runs recorded under another configuration are dropped, not plotted next to the current run", () => {
  const dir = workspace();
  seedHistory(dir, [
    record("2026-03-01T09:00:00.000Z", OTHER, { findings: 30, bySeverity: { error: 30 } }),
    record("2026-03-02T09:00:00.000Z", OTHER, { findings: 28, bySeverity: { error: 28 } }),
    record("2026-03-03T09:00:00.000Z", HASH, { findings: 9, bySeverity: { warning: 9 } }),
  ]);
  // Only the newest run carries the current hash, so there is nothing to trend against.
  assert.deepEqual(comparableRuns(readHistory(dir)).map((entry) => entry.findings), [9]);
  assert.equal(commentBody("before.json", "after.json", dir), BASE_BODY, "incomparable history means no trend");
});

test("the current configuration is the newest run's, so an older run under a newer hash is the trend", () => {
  const dir = workspace();
  seedHistory(dir, [
    record("2026-03-01T09:00:00.000Z", OTHER, { findings: 30, bySeverity: { error: 30 } }),
    record("2026-03-02T09:00:00.000Z", HASH, { findings: 9, bySeverity: { warning: 9 } }),
    record("2026-03-03T09:00:00.000Z", HASH, { findings: 4, bySeverity: { warning: 4 } }),
  ]);
  const body = commentBody("before.json", "after.json", dir);
  assert.doesNotMatch(body, /30/, "the run made with another configuration is not in the comment");
  assert.match(body, /\| 2026-03-02 \| 9 \| 0 \| 9 \| 0 \|\n\| 2026-03-03 \| 4 \| 0 \| 4 \| 0 \|/);
});

test(`the comment renders the newest ${TREND_RUNS} comparable runs and drops the older ones`, () => {
  const dir = workspace();
  const many = Array.from({ length: TREND_RUNS + 3 }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return record(`2026-04-${day}T09:00:00.000Z`, HASH, { findings: 40 - i, bySeverity: { note: 40 - i } });
  });
  seedHistory(dir, many);
  const body = commentBody("before.json", "after.json", dir);
  const rows = body.split("\n").filter((line) => /^\| 2026-/.test(line));
  assert.equal(rows.length, TREND_RUNS, "one row per run, no more");
  assert.equal(rows[0], "| 2026-04-04 | 37 | 0 | 0 | 37 |", "the three oldest comparable runs are dropped");
  assert.equal(rows.at(-1), "| 2026-04-13 | 28 | 0 | 0 | 28 |", "the newest run is the last row");
  assert.match(body, /\*\*Trend over the last 10 comparable runs/);
});

test("a damaged store is skipped like the reader skips it; the trend and the comment survive", () => {
  const dir = workspace();
  seedHistory(dir, [
    record("2026-03-01T09:00:00.000Z", HASH, { findings: 5, bySeverity: { warning: 5 } }),
    record("2026-03-02T09:00:00.000Z", HASH, { findings: 3, bySeverity: { warning: 3 } }),
  ]);
  // A truncated write, a record with no configuration to compare on, a timestamp that is not one,
  // and a leftover .tmp: none of them can be placed on a trend line, so none of them stop the run.
  seedFile(dir, "0003-20260303T090000000Z.json", '{"spec":1,"tool":"seawo');
  seedFile(dir, "0004-20260304T090000000Z.json", `${JSON.stringify(record("2026-03-04T09:00:00.000Z", "", { findings: 99, bySeverity: { error: 99 } }))}\n`);
  seedFile(dir, "0005-20260305T090000000Z.json", `${JSON.stringify(record("not a date", HASH, { findings: 99, bySeverity: { error: 99 } }))}\n`);
  seedFile(dir, ".0006-20260306T090000000Z.json.tmp", '{"spec":1,');
  const runs = comparableRuns(readHistory(dir));
  assert.deepEqual(runs.map((entry) => entry.findings), [5, 3], "only the intact comparable runs reach the comment");
  const body = commentBody("before.json", "after.json", dir);
  assert.match(body, /\| 2026-03-01 \| 5 \| 0 \| 5 \| 0 \|\n\| 2026-03-02 \| 3 \| 0 \| 3 \| 0 \|/);
  assert.doesNotMatch(body, /99/);
});

test("the body command writes the trended comment to the file the next step posts", () => {
  const dir = workspace();
  seedHistory(dir, [
    record("2026-03-01T09:00:00.000Z", HASH, { findings: 5, bySeverity: { warning: 5 } }),
    record("2026-03-02T09:00:00.000Z", HASH, { findings: 2, bySeverity: { warning: 2 } }),
  ]);
  const result = run(["body", "--before", "before.json", "--after", "after.json"], { cwd: dir });
  assert.equal(result.code, EXIT.ok, result.stderr);
  assert.equal(result.stdout, `seaworthy: comment body written to ${COMMENT_FILE}\n`, "the step log is unchanged");
  assert.equal(readFileSync(join(dir, ...COMMENT_FILE.split("/")), "utf8"), commentBody("before.json", "after.json", dir));
  assert.match(readFileSync(join(dir, ...COMMENT_FILE.split("/")), "utf8"), /\*\*Trend over the last 2 comparable runs/);
});

test("withTrend leaves any body it cannot place a trend in alone, and appends when it has no marker", () => {
  const empty: HistoryRecord[] = [];
  assert.equal(withTrend("body\n", empty), "body\n", "no history, no change");
  const two = [record("2026-03-01T09:00:00.000Z", HASH, { findings: 1 }), record("2026-03-02T09:00:00.000Z", HASH, { findings: 2 })];
  assert.ok(withTrend("plain body\n", two).startsWith("plain body\n\n**Trend"), "a marker-less body still gets the section at the end");
  assert.equal(withTrend(`${BASE_BODY}`, []) , BASE_BODY);
});
