import assert from "node:assert/strict";
import { test } from "node:test";

import { createBaseline } from "../src/baseline.js";
import { parseConfig } from "../src/config.js";
import { buildSite } from "../src/site.js";
import { verifySite } from "../src/verify.js";
import type { Check } from "../src/types.js";
import { makeSite, reportErrors } from "./helpers.js";

const PAGE = (extra = "") => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${extra}<img src="/a.png">\n</body></html>\n`;
const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test", standards: [] },
  run: (ctx) =>
    [...ctx.site.pages.values()].flatMap((page) =>
      page.elements.filter((e) => e.tagName === "img" && !e.attrs.some((a) => a.name === "alt")).map((e) => ({ message: "no alt", location: { file: page.file, line: e.sourceCodeLocation!.startLine, column: e.sourceCodeLocation!.startCol }, fix: { kind: "manual" as const, summary: "add alt" }, key: e.attrs.find((a) => a.name === "src")?.value ?? "" })),
    ),
};
const ids = [imgCheck.meta.id];
const cfg = (raw: unknown) => parseConfig(raw, "c.json", ids);
const run = (files: Record<string, string>, extra: Partial<Parameters<typeof verifySite>[0]> = {}) => verifySite({ folder: makeSite(files), rootLabel: "dist", checks: [imgCheck], now: new Date("2027-02-01T00:00:00Z"), ...extra });

test("a plain run reports findings and validates against the schema", async () => {
  const { report } = await run({ "index.html": PAGE(), "about.html": PAGE() });
  assert.equal(report.findings.length, 2);
  assert.deepEqual(reportErrors(report), []);
  assert.deepEqual(report.checks.map((c) => c.id), ["images.alt", "suppress.expired", "suppress.invalid"]);
});

test("config: off removes a check, severity overrides it, ignore drops files", async () => {
  const files = { "index.html": PAGE(), "drafts/wip.html": PAGE() };
  assert.equal((await run(files, { config: cfg({ checks: { "images.alt": "off" } }) })).report.findings.length, 0);
  const warned = (await run(files, { config: cfg({ checks: { "images.alt": "warning" } }) })).report;
  assert.deepEqual(warned.summary.bySeverity, { warning: 2 });
  const ignored = (await run(files, { config: cfg({ ignore: ["drafts/**"] }) })).report;
  assert.deepEqual(ignored.findings.map((f) => f.location.file), ["index.html"]);
});

test("suppressed findings leave the findings list but stay visible with their reason", async () => {
  const { report } = await run({ "index.html": PAGE("<!-- seaworthy-ignore images.alt: decorative -->\n") });
  assert.equal(report.findings.length, 0);
  assert.equal(report.summary.suppressed, 1);
  assert.equal(report.suppressed[0]!.reason, "decorative");
  assert.deepEqual(reportErrors(report), []);
});

test("a malformed or expired suppression is itself a finding", async () => {
  const bad = await run({ "index.html": PAGE("<!-- seaworthy-ignore images.alt -->\n") });
  assert.ok(bad.report.findings.some((f) => f.checkId === "suppress.invalid"));
  const old = await run({ "index.html": PAGE("<!-- seaworthy-ignore images.alt: waiting for the new logo until 2026-12-31 -->\n") });
  assert.deepEqual(old.report.findings.map((f) => f.checkId).sort(), ["images.alt", "suppress.expired"]);
  assert.deepEqual(reportErrors(old.report), []);
});

test("the baseline hides accepted findings and the pipeline returns what to record", async () => {
  const files = { "index.html": PAGE(), "about.html": PAGE() };
  const first = await run(files);
  assert.equal(first.unbaselined.length, 2);
  const baseline = createBaseline(first.unbaselined);
  const again = await run(files, { baseline });
  assert.equal(again.report.findings.length, 0);
  assert.deepEqual([again.report.summary.baselined, again.report.summary.baselineStale], [2, 0]);
  const grown = await run({ ...files, "new.html": PAGE() }, { baseline });
  assert.deepEqual(grown.report.findings.map((f) => f.location.file), ["new.html"]);
  const fixed = await run({ "index.html": PAGE().replace("<img", '<img alt="" ') }, { baseline });
  assert.deepEqual([fixed.report.findings.length, fixed.report.summary.baselineStale], [0, 2]);
  assert.equal(grown.unbaselined.length, 3, "unbaselined ignores the baseline");
});

test("suppressed findings are not recorded in the baseline", async () => {
  const { unbaselined } = await run({ "index.html": PAGE("<!-- seaworthy-ignore images.alt: decorative -->\n"), "b.html": PAGE() });
  assert.deepEqual(unbaselined.map((f) => f.location.file), ["b.html"]);
});

test("timings cover the pipeline stages and never reach the report", async () => {
  assert.equal((await run({ "index.html": PAGE() })).timings, undefined, "collecting timings is opt-in");

  const timed = await run({ "index.html": PAGE() }, { timings: true });
  assert.deepEqual(timed.timings?.stages.map((s) => s.stage), ["site", "checks", "suppressions", "baseline", "report"]);
  assert.deepEqual(timed.timings?.checks.map((c) => c.check), ["images.alt"]);
  assert.ok(timed.timings?.stages.every((s) => Number.isFinite(s.ms) && s.ms >= 0));
  assert.equal(JSON.stringify(timed.report).includes("timings"), false);
  assert.deepEqual(reportErrors(timed.report), []);
});

test("a graph supplied by the caller is not timed as a site stage", async () => {
  const folder = makeSite({ "index.html": PAGE() });
  const headless = await verifySite({ folder, site: buildSite(folder), rootLabel: "dist", checks: [imgCheck], timings: true });
  assert.deepEqual(headless.timings?.stages.map((s) => s.stage), ["checks", "suppressions", "baseline", "report"]);
});
