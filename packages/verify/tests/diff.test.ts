import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { EXIT, run } from "../src/cli.js";
import { ReportDiffError, diffReports, diffToJson, readReport } from "../src/diff.js";
import { runChecks } from "../src/engine.js";
import { buildReport, reportToJson } from "../src/report.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding, FindingDraft, Report } from "../src/types.js";
import { makeSite } from "./helpers.js";

// One finding per "dup" line, but every occurrence on a page shares one key, so counts of a
// fingerprint matter: 2 markers before and 1 after is one problem carried and one fixed.
const dup: Check = {
  meta: { id: "x.dup", title: "duplicated marker", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) =>
    [...ctx.site.pages.values()].flatMap((page): FindingDraft[] => {
      const drafts: FindingDraft[] = [];
      page.source.split(/\r?\n/).forEach((line, i) => {
        if (line.includes("dup")) drafts.push({ message: `marker on line ${i + 1}`, location: { file: page.file, line: i + 1 }, fix: { kind: "manual", summary: "remove the marker" }, key: "dup" });
      });
      return drafts;
    }),
};

const page = (markers: number): string => `<!doctype html><html lang="en"><head><title>t</title></head><body>\n${Array.from({ length: markers }, () => "- dup\n").join("")}</body>\n`;

async function reportOf(files: Record<string, string>, root: string): Promise<Report> {
  const site = buildSite(makeSite(files));
  const { findings, skipped, errors } = await runChecks({ site, checks: [dup] });
  return buildReport({ root, pages: site.pages.size, checks: [dup], findings, skipped, errors });
}

const before = reportOf({ "a.html": page(3), "b.html": page(2) }, "before");
const after = reportOf({ "a.html": page(3), "b.html": page(1), "c.html": page(1) }, "after");

const filesOf = (findings: readonly Finding[]): string[] => findings.map((f) => f.location.file);

test("diff groups findings into new, fixed, and unchanged, counting repeated fingerprints", async () => {
  const diff = diffReports(await before, await after);
  assert.equal(diff.summary.new, 1, "c.html gained a problem");
  assert.equal(diff.summary.fixed, 1, "b.html had two markers, now one");
  assert.equal(diff.summary.unchanged, 4, "3 on a.html and 1 on b.html stayed");
  assert.deepEqual(filesOf(diff.new), ["c.html"]);
  assert.deepEqual(filesOf(diff.fixed), ["b.html"]);
  assert.deepEqual(filesOf(diff.unchanged), ["a.html", "a.html", "a.html", "b.html"]);
});

test("the diff of two real engine reports is a stable JSON object with fixed key order", async () => {
  const text = diffToJson(diffReports(await before, await after));
  assert.equal(diffToJson(diffReports(await before, await after)), text, "byte-identical for the same inputs");
  const value = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(value), ["spec", "tool", "before", "after", "summary", "new", "fixed", "unchanged"]);
  assert.deepEqual(value.summary, { new: 1, fixed: 1, unchanged: 4 });
  assert.deepEqual(value.before, { root: "before", findings: 5 });
  assert.deepEqual(value.after, { root: "after", findings: 5 });
  const finding = (value.new as Finding[])[0]!;
  assert.equal(finding.checkId, "x.dup");
  assert.ok(typeof finding.fingerprint === "string" && finding.fingerprint.length > 0);
  assert.ok(text.endsWith("}\n"), "one trailing newline");
});

test("an identical report diffs to all-unchanged with no new or fixed findings", async () => {
  const report = await before;
  const diff = diffReports(report, report);
  assert.deepEqual(diff.summary, { new: 0, fixed: 0, unchanged: 5 });
  assert.deepEqual(filesOf(diff.unchanged), ["a.html", "a.html", "a.html", "b.html", "b.html"]);
});

test("a moved occurrence is unchanged: fingerprint identity, not line numbers", async () => {
  const report = await reportOf({ "a.html": page(2) }, "dist");
  const shifted = await reportOf({ "a.html": `<head></head>\n\n\n${Array.from({ length: 2 }, () => "- dup\n").join("")}` }, "dist");
  assert.notDeepEqual(shifted.findings.map((f) => f.location.line), report.findings.map((f) => f.location.line), "the same problems sit on other lines");
  const diff = diffReports(report, shifted);
  assert.deepEqual(diff.summary, { new: 0, fixed: 0, unchanged: 2 });
});

test("a report with only different fingerprints is all new or all fixed", async () => {
  const clean = await reportOf({ "clean.html": "<!doctype html><title>t</title>" }, "dist");
  assert.deepEqual(diffReports(clean, await before).summary, { new: 5, fixed: 0, unchanged: 0 });
  assert.deepEqual(diffReports(await before, clean).summary, { new: 0, fixed: 5, unchanged: 0 });
});

test("readReport parses a real report and explains what is wrong otherwise", async () => {
  const report = await before;
  const malformed = JSON.parse(reportToJson(report)) as { findings: unknown[] };
  malformed.findings[0] = {};
  const dir = makeSite({
    "report.json": reportToJson(report),
    "nojson.json": "{",
    "other.json": JSON.stringify({ tool: { name: "other" }, findings: [] }),
    "old.json": JSON.stringify({ spec: 9, tool: { name: "seaworthy" }, root: "dist", findings: [] }),
    "noroot.json": JSON.stringify({ spec: 0, tool: { name: "seaworthy" }, findings: [] }),
    "malformed.json": JSON.stringify(malformed),
  });
  const read = readReport(join(dir, "report.json"));
  assert.equal(read.root, report.root);
  assert.deepEqual(read.findings, report.findings);
  assert.throws(() => readReport(join(dir, "missing.json")), ReportDiffError);
  assert.throws(() => readReport(join(dir, "nojson.json")), /cannot read report/);
  assert.throws(() => readReport(join(dir, "other.json")), /is not a Seaworthy report file/);
  assert.throws(() => readReport(join(dir, "old.json")), /written for spec 9/);
  assert.throws(() => readReport(join(dir, "noroot.json")), /names no site root/);
  assert.throws(() => readReport(join(dir, "malformed.json")), /malformed finding/);
});

test("seaworthy diff prints one JSON object and a one-line summary", async () => {
  const cwd = makeSite({ "before.json": reportToJson(await before), "after.json": reportToJson(await after) });
  const result = await run(["diff", "before.json", "after.json"], { cwd });
  assert.equal(result.code, EXIT.ok);
  assert.deepEqual(JSON.parse(result.stdout).summary, { new: 1, fixed: 1, unchanged: 4 });
  assert.match(result.stderr, /^seaworthy: 1 new, 1 fixed, 4 unchanged findings\n$/);
  const second = await run(["diff", "before.json", "after.json"], { cwd });
  assert.equal(second.stdout, result.stdout, "the diff is deterministic");
});

test("diff argument and file mistakes are usage errors with a way back", async () => {
  const cwd = makeSite({ "nojson.json": "{", "other.json": JSON.stringify({ hello: 1 }) });
  for (const argv of [["diff"], ["diff", "before.json"], ["diff", "a.json", "b.json", "c.json"], ["diff", "--json", "a.json", "b.json"]]) {
    const result = await run(argv, { cwd });
    assert.equal(result.code, EXIT.usage, argv.join(" "));
    assert.match(result.stderr, /^seaworthy: diff takes exactly two report files/);
  }
  for (const [argv, message] of [
    [["diff", "missing.json", "other.json"], /cannot read report/],
    [["diff", "other.json", "missing.json"], /not a Seaworthy report file/],
    [["diff", "nojson.json", "other.json"], /cannot read report/],
    [["diff", "other.json", "nojson.json"], /not a Seaworthy report file/],
  ] as const) {
    const result = await run(argv, { cwd });
    assert.equal(result.code, EXIT.usage, argv.join(" "));
    assert.match(result.stderr, message);
    assert.match(result.stderr, /Run `seaworthy --help` for usage\./);
  }
});

test("--help mentions diff", async () => {
  const help = (await run(["--help"])).stdout;
  assert.match(help, /seaworthy diff <before\.json> <after\.json>/);
  assert.match(help, /Findings match by fingerprint/);
});
