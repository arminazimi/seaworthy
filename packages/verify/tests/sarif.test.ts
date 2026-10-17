import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli.js";
import { runChecks } from "../src/engine.js";
import { toSarif, sarifUri } from "../src/formats/sarif.js";
import { buildReport } from "../src/report.js";
import { buildSite } from "../src/site.js";
import type { Check, Report } from "../src/types.js";
import { makeSite, reportErrors, sarifErrors } from "./helpers.js";

const PAGE = '<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n<a href="/docs/guid.html">Guide</a>\n<img src="/a.png">\n<p class="muted">low</p>\n</body></html>\n';

const check = (id: string, severity: "error" | "warning" | "note", needs: ("html" | "browser")[], drafts: Check["run"]): Check => ({
  meta: { id, title: `title of ${id}`, severity, needs: ["html", ...needs], docs: `https://example.test/${id}`, standards: id === "images.alt" ? ["WCAG 1.1.1"] : [] },
  run: drafts,
});

const checks: Check[] = [
  check("links.internal", "error", [], () => [
    {
      message: "Link to /docs/guid.html points to a page that does not exist.",
      location: { file: "index.html", line: 4, column: 10 },
      fix: { kind: "edit", summary: "Point the link at /docs/guide.html.", edits: [{ file: "index.html", line: 4, action: "replace", find: "/docs/guid.html", replace: "/docs/guide.html" }] },
      key: "/docs/guid.html",
    },
  ]),
  check("images.alt", "warning", [], () => [
    {
      message: "<img> has no alt attribute.",
      location: { file: "index.html", line: 5 },
      fix: { kind: "edit", summary: "Add alt text.", edits: [{ file: "index.html", line: 5, action: "replace", find: '<img src="/a.png">', replace: '<img src="/a.png" alt="">', needsInput: true }] },
      key: "/a.png",
    },
  ]),
  check("a11y.color-contrast", "note", ["browser"], () => [
    { message: "Low contrast.", location: { file: "index.html", approximateLine: true, selector: "p.muted", snippet: '<p class="muted">low</p>' }, fix: { kind: "manual", summary: "Darken the text." }, key: "p.muted" },
  ]),
  check("x.stale-fix", "error", [], () => [
    { message: "Edit text is not on the line.", location: { file: "index.html", line: 2 }, fix: { kind: "edit", summary: "n/a", edits: [{ file: "index.html", line: 2, action: "replace", find: "NOT PRESENT", replace: "x" }] }, key: "k" },
  ]),
  check("x.crash", "error", [], () => {
    throw new Error("boom");
  }),
];

async function sample(): Promise<{ report: Report; sarif: any }> {
  const site = buildSite(makeSite({ "dist/index.html": PAGE }).replace(/$/, "") + "/dist");
  const result = await runChecks({ site, checks, enable: { browser: true } });
  const report = buildReport({ root: "dist", pages: site.pages.size, checks, findings: result.findings, skipped: result.skipped, errors: result.errors });
  const readLine = (file: string, line: number) => site.pages.get(`/${file}`)?.source.split(/\r?\n/)[line - 1];
  return { report, sarif: toSarif(report, { readLine }) };
}

test("SARIF output validates against the official 2.1.0 schema", async () => {
  const { sarif } = await sample();
  assert.deepEqual(sarifErrors(sarif), []);
});

test("an empty report is valid SARIF", () => {
  const sarif = toSarif(buildReport({ root: ".", pages: 0, checks: [], findings: [] }));
  assert.deepEqual(sarifErrors(sarif), []);
});

test("the schema validator really rejects bad logs", async () => {
  const { sarif } = await sample();
  const bad = JSON.parse(JSON.stringify(sarif));
  bad.runs[0].results[0].level = "fatal";
  assert.notDeepEqual(sarifErrors(bad), []);
  const noVersion = JSON.parse(JSON.stringify(sarif));
  delete noVersion.version;
  assert.notDeepEqual(sarifErrors(noVersion), []);
});

test("maps checks to rules and findings to results", async () => {
  const { report, sarif } = await sample();
  const run0 = sarif.runs[0];
  assert.equal(run0.tool.driver.name, "seaworthy");
  assert.deepEqual(run0.tool.driver.rules.map((r: any) => r.id), report.checks.map((c) => c.id));
  const rule = run0.tool.driver.rules.find((r: any) => r.id === "images.alt");
  assert.deepEqual([rule.shortDescription.text, rule.helpUri, rule.defaultConfiguration.level, rule.properties.tags], ["title of images.alt", "https://example.test/images.alt", "warning", ["WCAG 1.1.1"]]);
  assert.deepEqual(run0.tool.driver.rules.find((r: any) => r.id === "a11y.color-contrast").properties.tags, ["needs-browser"]);
  assert.equal(run0.results.length, report.findings.length);
  for (const result of run0.results) {
    assert.equal(run0.tool.driver.rules[result.ruleIndex].id, result.ruleId, "ruleIndex points at its rule");
    const finding = report.findings.find((f) => f.fingerprint === result.partialFingerprints["seaworthy/v1"])!;
    assert.equal(result.level, finding.severity);
    assert.equal(result.message.text, finding.message);
    assert.equal(result.properties.fixSummary, finding.fix.summary);
  }
  assert.equal(new Set(run0.results.map((r: any) => r.partialFingerprints["seaworthy/v1"])).size, run0.results.length, "fingerprints are unique");
});

test("locations are repository-relative and always carry a line", async () => {
  const { sarif } = await sample();
  const byRule = (id: string) => sarif.runs[0].results.find((r: any) => r.ruleId === id).locations[0].physicalLocation;
  assert.deepEqual(byRule("links.internal"), { artifactLocation: { uri: "dist/index.html" }, region: { startLine: 4, startColumn: 10 } });
  assert.deepEqual(byRule("images.alt").region, { startLine: 5 });
  assert.deepEqual(byRule("a11y.color-contrast").region, { startLine: 1 }, "no line anchors to the top of the file");
  assert.equal(sarifUri({ root: "." } as Report, "docs/a.html"), "docs/a.html");
  assert.equal(sarifUri({ root: "./out" } as Report, "a.html"), "out/a.html");
});

test("edits become SARIF fixes with the exact region of the text", async () => {
  const { sarif } = await sample();
  const withFix = sarif.runs[0].results.find((r: any) => r.ruleId === "links.internal");
  const change = withFix.fixes[0].artifactChanges[0];
  assert.equal(change.artifactLocation.uri, "dist/index.html");
  const region = change.replacements[0].deletedRegion;
  const line = PAGE.split("\n")[region.startLine - 1]!;
  assert.equal(line.slice(region.startColumn - 1, region.endColumn - 1), "/docs/guid.html", "the region covers exactly the text to replace");
  assert.equal(change.replacements[0].insertedContent.text, "/docs/guide.html");
  const alt = sarif.runs[0].results.find((r: any) => r.ruleId === "images.alt").fixes[0].artifactChanges[0].replacements[0];
  assert.equal(PAGE.split("\n")[alt.deletedRegion.startLine - 1]!.slice(alt.deletedRegion.startColumn - 1, alt.deletedRegion.endColumn - 1), '<img src="/a.png">');
});

test("an edit whose text is not on the line is omitted instead of guessed", async () => {
  const { sarif } = await sample();
  const stale = sarif.runs[0].results.find((r: any) => r.ruleId === "x.stale-fix");
  assert.equal("fixes" in stale, false);
  const manual = sarif.runs[0].results.find((r: any) => r.ruleId === "a11y.color-contrast");
  assert.equal("fixes" in manual, false);
});

test("skipped checks are notes and crashed checks are errors in the invocation", async () => {
  const site = buildSite(makeSite({ "index.html": PAGE }));
  const result = await runChecks({ site, checks });
  const report = buildReport({ root: "dist", pages: 1, checks, findings: result.findings, skipped: result.skipped, errors: result.errors });
  const invocation = (toSarif(report) as any).runs[0].invocations[0];
  assert.equal(invocation.executionSuccessful, false);
  const levels = invocation.toolExecutionNotifications.map((n: any) => [n.level, n.descriptor.id]);
  assert.deepEqual(levels, [["note", "a11y.color-contrast"], ["error", "x.crash"]]);
  assert.deepEqual(sarifErrors(toSarif(report)), []);
});

test("--format sarif works end to end and the JSON report is unaffected", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const sarif = JSON.parse((await run(["verify", "dist", "--format", "sarif"], { cwd, checks: [checks[0]!] })).stdout);
  assert.deepEqual(sarifErrors(sarif), []);
  assert.equal(sarif.runs[0].results[0].fixes[0].artifactChanges[0].replacements[0].deletedRegion.startColumn, 10, "region found through the CLI's source lookup");
  const json = JSON.parse((await run(["verify", "dist", "--format", "json"], { cwd, checks: [checks[0]!] })).stdout);
  assert.deepEqual(reportErrors(json), []);
});
