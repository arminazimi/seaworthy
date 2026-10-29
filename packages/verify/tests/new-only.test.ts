// Issue #340: `--new-only` reports only findings the previous run did not have. It compares
// findings by fingerprint — the same stable identity the baseline and `seaworthy diff` match on —
// against the keys the newest .seaworthy/history record stored. What it drops is counted under
// the existing summary.findingsOmitted, never silently.

import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EXIT, run } from "../src/cli.js";
import { fingerprint } from "../src/engine.js";
import { appendHistory, buildHistoryRecord, HISTORY_DIR, HISTORY_KEYS_MAX, previousRunKeys, readHistory, stableStringify, type HistoryRecord } from "../src/history.js";
import { historyToCsv } from "../src/cli/history.js";
import { buildReport } from "../src/report.js";
import type { Check, Finding, Report, Severity } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = '<!doctype html><title>t</title><img src="a.png">';
const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) => [...ctx.site.pages.values()].filter((p) => p.source.includes("<img src=")).map((p) => ({ message: "no alt", location: { file: p.file, line: 1 }, fix: { kind: "manual" as const, summary: "add alt" }, key: p.url })),
};

const STORE_FILE = /^\d{4,}-\d{8}T\d{9}Z\.json$/;

/** The store's records in run order (oldest first), or none when the folder never verified. */
const recordFiles = (cwd: string): string[] => {
  try {
    return readdirSync(join(cwd, HISTORY_DIR)).filter((name) => STORE_FILE.test(name)).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  } catch {
    return [];
  }
};

const storedRecord = (cwd: string, index: number): Record<string, unknown> =>
  JSON.parse(readFileSync(join(cwd, HISTORY_DIR, recordFiles(cwd)[index] as string), "utf8")) as Record<string, unknown>;

const seed = (cwd: string, name: string, content: string): void => {
  mkdirSync(join(cwd, HISTORY_DIR), { recursive: true });
  writeFileSync(join(cwd, HISTORY_DIR, name), content);
};

const finding = (file: string, key: string, severity: Severity = "warning"): Finding => ({
  checkId: "x.noisy",
  severity,
  message: "m",
  location: { file, line: 1 },
  fix: { kind: "manual", summary: "s", edits: [], appliesTo: "built-output" },
  fingerprint: fingerprint("x.noisy", file, key),
});

const reportOf = (findings: readonly Finding[]): Report => buildReport({ root: "dist", pages: 1, checks: [], findings });

/** One site map, one folder: a test reads as the loop of runs it is. */
const verifyIn = (cwd: string) => (...extra: string[]) => run(["verify", "dist", ...extra], { cwd, checks: [imgCheck] });

test("--new-only drops a finding the previous run had and exits clean", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const verify = verifyIn(cwd);
  const first = await verify("--format", "json");
  assert.equal(first.code, EXIT.findings);

  const second = await verify("--new-only", "--format", "json");
  const report = JSON.parse(second.stdout);
  assert.equal(second.code, EXIT.ok, "the only finding was there last run, so nothing is new");
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.findingsOmitted, 1, "the dropped finding is counted, not silently gone");
});

test("--new-only keeps a genuinely new finding and counts the old one", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const verify = verifyIn(cwd);
  await verify("--format", "json");
  writeFileSync(join(cwd, "dist", "b.html"), PAGE);

  const second = await verify("--new-only", "--format", "json");
  const report = JSON.parse(second.stdout);
  assert.equal(second.code, EXIT.findings);
  assert.deepEqual(report.findings.map((f: { location: { file: string } }) => f.location.file), ["b.html"], "only the new page is reported");
  assert.equal(report.summary.findingsOmitted, 1);
});

test("--new-only stays stable over repeated runs: filtered findings do not come back as new", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const verify = verifyIn(cwd);
  await verify("--format", "json");
  for (let i = 0; i < 3; i++) {
    const again = await verify("--new-only", "--format", "json");
    assert.equal(again.code, EXIT.ok, "run 1, 2 or 3: the keys stored are what the run found, not what it reported");
    assert.equal(JSON.parse(again.stdout).summary.findingsOmitted, 1);
  }
});

test("no history: --new-only reports everything, says so in human output, and never touches the JSON", async () => {
  const noticed = await verifyIn(makeSite({ "dist/index.html": PAGE }))("--new-only");
  assert.equal(noticed.code, EXIT.findings);
  assert.match(noticed.stdout, /--new-only found no previous run with stored findings/, "human output names the missing comparison");

  // Machine output is byte-identical with and without the flag on fresh folders, and carries no notice.
  const withFlag = await verifyIn(makeSite({ "dist/index.html": PAGE }))("--new-only", "--format", "json");
  const plain = await verifyIn(makeSite({ "dist/index.html": PAGE }))("--format", "json");
  assert.equal(withFlag.stdout, plain.stdout, "the report JSON gains no field and no notice for --new-only");
  assert.equal(JSON.parse(withFlag.stdout).findings.length, 1, "everything is reported when nothing is known");
});

test("a record from before finding keys existed has unknown keys: report everything, with the notice", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  // Write the record by hand the way the pre-#340 writer did: counts only, no findings field.
  appendHistory(cwd, {
    spec: 1,
    tool: "seaworthy",
    started: "2026-03-01T00:00:00.000Z",
    root: "dist",
    pages: 1,
    configHash: "a".repeat(64),
    counts: { findings: 1, bySeverity: { error: 1 }, byCheck: { "images.alt": 1 }, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0 },
  });
  const pretty = await verifyIn(cwd)("--new-only");
  assert.equal(pretty.code, EXIT.findings, "the finding is reported");
  assert.match(pretty.stdout, /no previous run with stored findings/, "and the notice explains why the filter did not apply");
});

test("a previous run of a different folder is not comparable: --new-only reports everything", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "out/index.html": PAGE });
  await run(["verify", "dist", "--format", "json"], { cwd, checks: [imgCheck] });
  const other = await run(["verify", "out", "--new-only"], { cwd, checks: [imgCheck] });
  assert.equal(other.code, EXIT.findings, "dist's keys say nothing about out");
  assert.match(other.stdout, /no previous run with stored findings/);
});

test("the newest record stores the run's fingerprints; older records do not carry keys", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "dist/b.html": PAGE });
  const verify = verifyIn(cwd);
  const first = await verify("--format", "json");
  const fingerprints = (JSON.parse(first.stdout).findings as { fingerprint: string }[]).map((f) => f.fingerprint);
  const withKeys = storedRecord(cwd, 0).findings as string[];
  assert.deepEqual([...withKeys].sort(), fingerprints.sort(), "keys are the fingerprints the run found — the baseline's identity, not a second formula");
  assert.deepEqual(withKeys, [...withKeys].sort(), "stored sorted");
  assert.equal(withKeys.length, new Set(withKeys).size, "deduplicated");

  await verify("--format", "json");
  assert.equal(storedRecord(cwd, 0).findings, undefined, "the previous newest lost its keys: at most one record carries them");
  assert.notEqual(storedRecord(cwd, 1).findings, undefined, "the newest one has them");
  assert.equal(recordFiles(cwd).length, 2, "and it is still one file per run");
});

test("a clean run stores the empty key list: everything next run is genuinely new", async () => {
  const cwd = makeSite({ "dist/index.html": "<!doctype html><title>ok</title>" });
  await verifyIn(cwd)("--format", "json");
  assert.deepEqual(storedRecord(cwd, 0).findings, [], "known-and-empty, not unknown");
  writeFileSync(join(cwd, "dist", "b.html"), PAGE);
  const next = await verifyIn(cwd)("--new-only", "--format", "json");
  const report = JSON.parse(next.stdout);
  assert.equal(report.findings.length, 1, "no notice needed: the previous run simply had nothing");
  assert.equal(report.summary.findingsOmitted, undefined);
  const pretty = await verifyIn(cwd)("--new-only");
  assert.doesNotMatch(pretty.stdout, /no previous run/, "usable keys, even an empty list, go without the notice");
});

test("a run with more findings than HISTORY_KEYS_MAX stores no keys rather than a partial list", () => {
  const many: Finding[] = [];
  for (let i = 0; i <= HISTORY_KEYS_MAX; i++) many.push(finding(`f${String(i)}.html`, `/i${String(i)}`));
  const record = buildHistoryRecord(reportOf(many.slice(0, 10)), { started: "2026-03-18T10:15:00.123Z", configHash: "a".repeat(64), findings: many });
  assert.equal(record.findings, undefined, "over the cap: unknown, so --new-only will report everything instead of half-truths");
  const under: Finding[] = [];
  for (let i = 0; i < HISTORY_KEYS_MAX; i++) under.push(finding(`f${String(i)}.html`, `/i${String(i)}`));
  assert.equal(buildHistoryRecord(reportOf(under.slice(0, 10)), { started: "2026-03-18T10:15:00.123Z", configHash: "a".repeat(64), findings: under }).findings?.length, HISTORY_KEYS_MAX, "exactly at the cap the keys fit: the full found list, not the report's capped one");
  assert.equal(buildHistoryRecord(reportOf(under.slice(0, 10)), { started: "2026-03-18T10:15:00.123Z", configHash: "a".repeat(64) }).findings?.length, 10, "with no found list given, the report's own findings are the source");
});

test("previousRunKeys reads the newest record for the same root, or undefined for unknown", () => {
  assert.equal(previousRunKeys([], "dist"), undefined, "no runs is unknown, not empty");
  const rec = (root: string, findings?: string[]): HistoryRecord => ({
    spec: 1,
    tool: "seaworthy",
    started: "2026-03-01T00:00:00.000Z",
    root,
    pages: 1,
    configHash: "a".repeat(64),
    counts: { findings: 0, bySeverity: {}, byCheck: {}, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0 },
    ...(findings === undefined ? {} : { findings }),
  });
  assert.equal(previousRunKeys([rec("dist")], "dist"), undefined, "a record without the field is unknown");
  assert.deepEqual([...(previousRunKeys([rec("dist", [])], "dist") ?? new Set(["wrong"]))], []);
  assert.deepEqual([...(previousRunKeys([rec("dist", ["a"]), rec("dist", ["b"])], "dist") ?? new Set())], ["b"], "the newest run is the previous one");
  assert.equal(previousRunKeys([rec("dist", ["a"]), rec("out", ["b"])], "dist"), undefined, "a newest record for another root is not comparable");
});

/** A complete record with the given timestamp and keys; the writer needs the real shape. */
function rec(started: string, findings: string[]): HistoryRecord {
  return {
    spec: 1,
    tool: "seaworthy",
    started,
    root: "dist",
    pages: 1,
    configHash: "a".repeat(64),
    counts: { findings: findings.length, bySeverity: {}, byCheck: {}, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0 },
    findings,
  };
}

test("stripping keys off an older record changes only that field", () => {
  const cwd = makeSite({});
  appendHistory(cwd, rec("2026-03-01T00:00:00.000Z", ["deadbeefdeadbeef"]));
  const first = readFileSync(join(cwd, HISTORY_DIR, "0001-20260301T000000000Z.json"), "utf8");
  appendHistory(cwd, rec("2026-03-02T00:00:00.000Z", ["1234567890abcdef"]));
  const stripped = JSON.parse(first) as HistoryRecord;
  delete (stripped as { findings?: string[] }).findings;
  assert.equal(readFileSync(join(cwd, HISTORY_DIR, "0001-20260301T000000000Z.json"), "utf8"), stableStringify(stripped), "same bytes, minus the findings field");
});

test("the omitted counter is shared, not double-counted: baseline hides first", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  await verifyIn(cwd)("--format", "json");
  await verifyIn(cwd)("--update-baseline", "b.json");
  const combined = await verifyIn(cwd)("--baseline", "b.json", "--new-only", "--format", "json");
  const report = JSON.parse(combined.stdout);
  assert.equal(report.summary.baselined, 1, "the baseline accepted it");
  assert.equal(report.summary.findingsOmitted, undefined, "and --new-only did not count the same finding again");
  assert.equal(combined.code, EXIT.ok);
});

test("the omitted counter is shared, not double-counted: suppressions hide first", async () => {
  const cwd = makeSite({
    "dist/index.html": PAGE,
    "dist/b.html": PAGE,
    "seaworthy.config.json": JSON.stringify({ suppressions: [{ check: "images.alt", file: "index.html", reason: "decorative sprite" }] }),
  });
  const verify = verifyIn(cwd);
  await verify("--format", "json");
  const second = await verify("--new-only", "--format", "json");
  const report = JSON.parse(second.stdout);
  assert.equal(report.summary.suppressed, 1, "the suppressed finding stays counted as suppressed");
  assert.equal(report.summary.findingsOmitted, 1, "only the reported-and-known finding lands in the omitted count");
  assert.equal(second.code, EXIT.ok);
});

test("the omitted counter is shared, not double-counted: --changed scopes first", async () => {
  const cwd = makeSite({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  await run(["verify", "dist", "--changed", "--format", "json"], { cwd, checks: [imgCheck] });
  writeFileSync(join(cwd, "dist", "b.html"), `${PAGE}<p>edited</p>`);
  const second = await run(["verify", "dist", "--changed", "--new-only", "--format", "json"], { cwd, checks: [imgCheck] });
  const report = JSON.parse(second.stdout);
  assert.equal(report.summary.changedFiles, 1, "only b.html changed");
  assert.equal(report.summary.findingsOmitted, 1, "a.html is out of --changed's scope, not a --new-only omission: the count is b.html alone");
  assert.equal(second.code, EXIT.ok);
});

test("caps and --new-only add up in one findingsOmitted", () => {
  const findings = [finding("a.html", "/a"), finding("b.html", "/b"), finding("c.html", "/c")];
  const report = buildReport({ root: "dist", pages: 1, checks: [], findings, maxFindings: 1, alreadyKnown: 1 });
  assert.deepEqual([report.summary.findings, report.summary.findingsOmitted], [1, 3], "one kept, one cut by the cap, one known from last run");
  assert.deepEqual(report.findings.map((f) => f.location.file), ["a.html"], "the kept finding is the report's first");
  const untouched = buildReport({ root: "dist", pages: 1, checks: [], findings });
  assert.equal(untouched.summary.findingsOmitted, undefined, "no field without either cause");
});

test("the #376 exports are unchanged: csv gains no column, json stays the records on disk", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const verify = verifyIn(cwd);
  await verify("--format", "json");
  await verify("--new-only", "--format", "json");

  const records = readHistory(cwd);
  assert.equal(records.length, 2);
  assert.notEqual(records[1]?.findings, undefined, "the newest record on disk carries keys");

  const csv = await run(["history", "--format", "csv"], { cwd });
  assert.equal(csv.stdout, historyToCsv(records.map(({ findings: _keys, ...withoutKeys }) => withoutKeys)), "the key field adds no column and no cell: the csv is what it was before #340");
  assert.equal(csv.stdout.split("\n")[0], "runAt,root,findings,errors,warnings,notes,check:images.alt");

  const json = await run(["history", "--format", "json"], { cwd });
  assert.equal(json.stdout, stableStringify(records), "the json export is still the stored records verbatim, oldest first");
});

test("a store written by hand without keys still exports exactly as before", async () => {
  const cwd = makeSite({});
  const plain = { spec: 1, tool: "seaworthy", started: "2026-03-01T00:00:00.000Z", root: "dist", pages: 2, configHash: "a".repeat(64), counts: { findings: 4, bySeverity: { warning: 4 }, byCheck: { "x.noisy": 4 }, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0 } };
  seed(cwd, "0001-20260301T000000000Z.json", stableStringify(plain));
  const before = await run(["history"], { cwd });
  const keyed = { ...plain, findings: ["deadbeefdeadbeef"] };
  seed(cwd, "0001-20260301T000000000Z.json", stableStringify(keyed));
  const after = await run(["history"], { cwd });
  assert.equal(historyToCsv(JSON.parse(before.stdout) as HistoryRecord[]), historyToCsv(JSON.parse(after.stdout) as HistoryRecord[]), "csv bytes are identical with and without the field");
  assert.notEqual(before.stdout, after.stdout, "json mirrors the store, as its help promises: the new field rides along, nothing else moves");
});

test("--new-only with --no-history is a usage error", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const both = await run(["verify", "dist", "--new-only", "--no-history"], { cwd, checks: [imgCheck] });
  assert.equal(both.code, EXIT.usage);
  assert.match(both.stderr, /^seaworthy: --new-only compares with \.seaworthy\/history/);
});
