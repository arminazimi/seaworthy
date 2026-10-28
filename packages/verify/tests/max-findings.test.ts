import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { run, EXIT } from "../src/cli.js";
import { parseConfig, resolveChecks } from "../src/config.js";
import { DEFAULT_MAX_FINDINGS, buildReport, capFindings, compareFindings } from "../src/report.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { verifySite } from "../src/verify.js";
import type { Check, Finding, FindingDraft } from "../src/types.js";
import { makeSite, reportErrors } from "./helpers.js";

const meta = (id = "x.noisy"): Check["meta"] => ({ id, title: id, severity: "warning", needs: ["html"], docs: `https://example.test/${id}`, standards: [] });
const finding = (checkId: string, file: string, line: number): Finding => ({
  checkId,
  severity: "warning",
  message: "m",
  location: { file, line },
  fix: { kind: "manual", summary: "fix", edits: [], appliesTo: "built-output" },
  fingerprint: `${checkId}-${file}-${line}`,
});

/** A check that reports `lines` findings on each of the last `pages` pages, so caps have something to cut. */
const noisy = (pages: number, lines = 3): Check => ({
  meta: meta(),
  *run(ctx): IterableIterator<FindingDraft> {
    for (const page of [...ctx.site.pages.values()].map((p) => p.file).sort().reverse().slice(0, pages))
      for (const line of Array.from({ length: lines }, (_, i) => i + 1))
        yield { message: `noisy ${page}:${line}`, location: { file: page, line, column: 1 }, fix: { kind: "manual", summary: "fix it" }, key: `/${page}#${line}` };
  },
});

test("the default cap applies without flags, and only truncation changes the report", async () => {
  assert.equal(DEFAULT_MAX_FINDINGS, 1000);
  const check = noisy(3, 2);
  const findings = (await runChecks({ site: buildSite(makeSite({ "p0.html": "<title>t</title>", "p1.html": "<title>t</title>", "p2.html": "<title>t</title>" })), checks: [check] })).findings;
  const plain = buildReport({ root: ".", pages: 3, checks: [check], findings });
  assert.deepEqual(plain.summary, { pages: 3, findings: 6, bySeverity: { warning: 6 }, suppressed: 0, baselined: 0, baselineStale: 0 }, "no findingsOmitted when nothing was cut");
  assert.deepEqual(plain.summary, buildReport({ root: ".", pages: 3, checks: [check], findings, maxFindings: DEFAULT_MAX_FINDINGS }).summary);

  const capped = buildReport({ root: ".", pages: 3, checks: [check], findings, maxFindings: 4 });
  assert.equal(capped.summary.findingsOmitted, 2);
  assert.equal(capped.summary.findings, 4);
  assert.deepEqual(capped.findings.map((f) => f.location.line), [1, 2, 1, 2], "the kept findings are the sorted report's first");
  assert.deepEqual(reportErrors(capped), [], "a truncated report still validates against the report spec");
});

test("capFindings keeps report order under per-check caps and a global cap", () => {
  const findings = [finding("x.a", "a.html", 1), finding("x.a", "a.html", 2), finding("x.a", "a.html", 3), finding("x.b", "a.html", 4), finding("x.b", "a.html", 5)];
  assert.deepEqual([...findings].sort(compareFindings), findings, "the fixture is already in report order");

  const capped = capFindings(findings, 3, { "x.a": 1, "x.b": 2 });
  assert.deepEqual(capped.findings.map((f) => [f.checkId, f.location.line]), [["x.a", 1], ["x.b", 4], ["x.b", 5]]);
  assert.equal(capped.omitted, 2);

  const tighter = capFindings(findings, 2, { "x.a": 1, "x.b": 2 });
  assert.deepEqual(tighter.findings.map((f) => f.location.line), [1, 4]);
  assert.equal(tighter.omitted, 3);

  assert.deepEqual(capFindings(findings, 100), { findings, omitted: 0 });
  assert.deepEqual(capFindings(findings, 100, {}), { findings, omitted: 0 }, "an empty per-check map does nothing");
});

test("a per-check cap resolves like every other check setting: exact beats prefix, longer prefix beats shorter", () => {
  const check: Check = { meta: meta("x.noisy"), run: () => [] };
  const config = parseConfig({ checks: { "x.*": { maxFindings: 50 }, "x.noisy": { maxFindings: 5 } } }, "c.json", ["x.noisy"]);
  assert.deepEqual(resolveChecks(config, [check]).maxFindings, { "x.noisy": 5 });

  const prefix = resolveChecks(parseConfig({ checks: { "x.*": { maxFindings: 50 } } }, "c.json", ["x.noisy"]), [check]);
  assert.deepEqual(prefix.maxFindings, { "x.noisy": 50 });

  assert.deepEqual(resolveChecks(parseConfig({}, "c.json", ["x.noisy"]), [check]).maxFindings, {});
});

test("a per-check cap config key must be a whole number of at least 1", () => {
  const config = (raw: unknown) => parseConfig(raw, "c.json", ["x.noisy"]);
  assert.equal(config({ checks: { "x.noisy": { maxFindings: 20 } } }).checks["x.noisy"]!.maxFindings, 20);
  assert.throws(() => config({ checks: { "x.noisy": { maxFindings: 0 } } }), /"x\.noisy"\.maxFindings: must be a whole number of at least 1, got 0/);
  assert.throws(() => config({ checks: { "x.noisy": { maxFindings: "many" } } }), /must be a whole number of at least 1/);
  assert.throws(() => config({ checks: { "x.noisy": { maxFinidngs: 5 } } }), /unknown key\. Allowed keys: off, severity, options, maxFindings/);
});

test("the pipeline caps the report and still returns everything beyond it for the baseline", async () => {
  const check = noisy(3, 2);
  const config = parseConfig({ checks: { "x.noisy": { maxFindings: 4 } } }, "c.json", ["x.noisy"]);
  const run = (extra: Partial<Parameters<typeof verifySite>[0]> = {}) =>
    verifySite({ folder: makeSite({ "p0.html": "<title>t</title>", "p1.html": "<title>t</title>", "p2.html": "<title>t</title>" }), rootLabel: "dist", checks: [check], config, now: new Date("2027-02-01T00:00:00Z"), ...extra });

  const capped = await run();
  assert.equal(capped.report.findings.length, 4);
  assert.equal(capped.report.summary.findingsOmitted, 2);
  assert.deepEqual(reportErrors(capped.report), []);
  assert.equal(capped.unbaselined.length, 6, "unbaselined is uncapped, so --update-baseline records everything");
  assert.ok(capped.report.prompt !== undefined, "the prompt covers the kept findings, which is what the report has");

  const global = await run({ maxFindings: 2 });
  assert.equal(global.report.findings.length, 2);
  assert.equal(global.report.summary.findingsOmitted, 4);
});

const BREAKING = (n: number): string =>
  `<!doctype html>\n<html><head><title>t</title></head>\n<body>\n${Array.from({ length: n }, (_, i) => `<a href="/missing-${i}.html">x</a>`).join("\n")}\n</body></html>\n`;

const CLEAN = fileURLToPath(new URL("../../../../fixtures/clean/minimal/site", import.meta.url));

test("--max-findings keeps every output format byte-identical when nothing is truncated", async () => {
  for (const format of ["pretty", "json", "markdown", "sarif"]) {
    const plain = await run(["verify", CLEAN, "--format", format]);
    const capped = await run(["verify", CLEAN, "--format", format, "--max-findings", "500"]);
    assert.equal(capped.code, plain.code, format);
    assert.equal(capped.stdout, plain.stdout, `${format} output is unchanged when the cap is never reached`);
    const report = JSON.parse((await run(["verify", CLEAN, "--format", "json"])).stdout);
    assert.equal(report.summary.findingsOmitted, undefined);
  }
});

test("--max-findings caps output exactly and counts what it omitted", async () => {
  const site = makeSite({ "a.html": "<title>t</title>", "b.html": "<title>t</title>" });
  const args = ["verify", site, "--format", "json"], env = { checks: [noisy(2, 5)] };
  const asReport = async (extra: string[]) => JSON.parse((await run([...args, ...extra], env)).stdout);

  const report = await asReport(["--max-findings", "5"]);
  assert.equal(report.summary.findings, 5);
  assert.equal(report.summary.findingsOmitted, 5);
  assert.equal(report.findings.length, 5);
  assert.deepEqual(reportErrors(report), [], "a truncated report validates against the report spec");
  assert.equal((await run([...args, ...["--max-findings", "5"].slice(0, 0), "--max-findings", "5", "--format", "markdown"], env)).stdout.match(/findings cap/)?.length, 1, "markdown mentions the omission");

  const pretty = (await run(["verify", site, "--max-findings", "5"], env)).stdout;
  assert.match(pretty, /^5 findings beyond the findings cap are omitted/m, "pretty output names the omitted count");
  const listed = (pretty.match(/x\.noisy  noisy /g) ?? []).length;
  assert.equal(listed, 5, "pretty lists exactly the kept findings");

  assert.equal((await asReport(["--max-findings", "1000"])).summary.findingsOmitted, undefined, "no field when the cap is not reached");
  assert.equal((await asReport([])).summary.findingsOmitted, undefined, "no field by default on a small site");
});

test("--max-findings is parsed like every flag, rejects bad values, and combines with the per-check cap", async () => {
  const site = makeSite({ "index.html": BREAKING(3) });
  for (const [argv, message] of [
    [["--max-findings"], /^(?:seaworthy: )?--max-findings needs a value/],
    [["--max-findings", "0"], /^(?:seaworthy: )?--max-findings must be a whole number of at least 1, got "0"/],
    [["--max-findings", "-3"], /^(?:seaworthy: )?--max-findings must be a whole number of at least 1, got "-3"/],
    [["--max-findings", "ten"], /^(?:seaworthy: )?--max-findings must be a whole number of at least 1, got "ten"/],
    [["--max-findings", "1.5"], /^(?:seaworthy: )?--max-findings must be a whole number of at least 1, got "1\.5"/],
    [["--max-findings=1.5"], /^(?:seaworthy: )?--max-findings must be a whole number of at least 1, got "1\.5"/],
  ] as [string[], RegExp][]) {
    const result = await run(["verify", site, ...argv]);
    assert.equal(result.code, EXIT.usage, argv.join(" "));
    assert.match(result.stderr, message);
  }

  // The cap in the config applies with no flag at all. The stub check is the only one running, so counts are exact.
  const cwd = makeSite({ "site/a.html": "<title>t</title>", "site/b.html": "<title>t</title>", "seaworthy.config.json": JSON.stringify({ checks: { "x.noisy": { maxFindings: 2 } } }) });
  const configEnv = { checks: [noisy(2, 5)] };
  const configured = JSON.parse((await run(["verify", "site", "--format", "json"], { cwd, ...configEnv })).stdout);
  assert.equal(configured.summary.findings, 2);
  assert.equal(configured.summary.findingsOmitted, 8);

  // ...and the flag tightens it further.
  const tighter = JSON.parse((await run(["verify", "site", "--format", "json", "--max-findings", "1"], { cwd, ...configEnv })).stdout);
  assert.equal(tighter.summary.findings, 1);
  assert.equal(tighter.summary.findingsOmitted, 9);
});

test("--update-baseline records findings beyond the cap, so adoption sees the whole site", async () => {
  const cwd = makeSite({ "site/index.html": BREAKING(6) });
  const stubEnv = { checks: [noisy(1, 6)] };
  const written = await run(["verify", "site", "--update-baseline", "b.json", "--max-findings", "3"], { cwd, ...stubEnv });
  assert.equal(written.code, EXIT.ok);
  assert.match(written.stdout, /baseline written to b\.json \(6 findings in 6 entries\)/, "the baseline counts every finding, capped or not");
  const adopted = await run(["verify", "site", "--format", "json", "--max-findings", "3", "--baseline", "b.json"], { cwd, ...stubEnv });
  assert.equal(adopted.code, EXIT.ok);
  const report = JSON.parse(adopted.stdout);
  assert.deepEqual([report.summary.findings, report.summary.baselined, report.summary.findingsOmitted], [0, 6, undefined], "everything was accepted; nothing was truncated");
});

test("pretty prints no cap note when nothing was omitted", async () => {
  const pretty = (await run(["verify", CLEAN])).stdout;
  assert.doesNotMatch(pretty, /findings cap/);
});
