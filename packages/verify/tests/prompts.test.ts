import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli.js";
import { formatMarkdown } from "../src/formats/markdown.js";
import { formatPretty } from "../src/formats/pretty.js";
import { toSarif } from "../src/formats/sarif.js";
import { buildReport, reportToJson } from "../src/report.js";
import { findingPrompt, reportPrompt } from "../src/prompt.js";
import type { Check, Finding } from "../src/types.js";
import type { SuppressedFinding } from "../src/suppress.js";
import { makeSite, reportErrors, sarifErrors } from "./helpers.js";

const PAGE = '<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n<a href="/docs/guid.html">Guide</a>\n<img src="/a.png">\n</body></html>\n';

const check = (id: string, severity: "error" | "warning" | "note"): Check => ({
  meta: { id, title: `title of ${id}`, severity, needs: ["html"], docs: `https://example.test/${id}`, standards: [] },
  run: () => [],
});

const checks: Check[] = [check("a11y.color-contrast", "note"), check("images.alt", "warning"), check("links.internal", "error")];

const edited: Finding = {
  checkId: "links.internal",
  severity: "error",
  message: "Link to /docs/guid.html points to a page that does not exist.",
  location: { file: "docs/link.html", line: 4, column: 10 },
  fix: { kind: "edit", summary: "Point the link at /docs/guide.html.", edits: [{ file: "docs/link.html", line: 4, action: "replace", find: "/docs/guid.html", replace: "/docs/guide.html" }], appliesTo: "built-output" },
  fingerprint: "aaaaaaaa11111111",
};

const needsInput: Finding = {
  checkId: "images.alt",
  severity: "warning",
  message: '<img src="/a.png"> has no alt attribute.',
  location: { file: "docs/link.html", line: 5 },
  fix: { kind: "edit", summary: "Add alt text.", edits: [{ file: "docs/link.html", line: 5, action: "replace", find: '<img src="/a.png">', replace: '<img src="/a.png" alt="">', needsInput: true }], appliesTo: "built-output" },
  fingerprint: "bbbbbbbb22222222",
};

const manual: Finding = {
  checkId: "a11y.color-contrast",
  severity: "note",
  message: "Low contrast.",
  location: { file: "docs/link.html", approximateLine: true, selector: "p.muted" },
  fix: { kind: "manual", summary: "Darken the text.", edits: [], appliesTo: "built-output" },
  fingerprint: "cccccccc33333333",
};

const findings: Finding[] = [edited, needsInput, manual];
const suppressed: SuppressedFinding = { checkId: "html.charset", fingerprint: "dddddddd44444444", file: "a.html", reason: "on purpose", source: "config" };

const sample = (root = "dist"): ReturnType<typeof buildReport> =>
  buildReport({ root, pages: 2, checks, findings, baselined: 2, baselineStale: 1, suppressed: [suppressed] });

test("the finding prompt is one line with the check, the location, and the fix", () => {
  const report = sample();
  const prompt = report.findings[0]!.prompt;
  assert.ok(prompt !== undefined);
  assert.ok(!prompt.includes("\n"), "the prompt stays on one line");
  assert.match(prompt, /^Fix this Seaworthy finding\. Check links\.internal \(error\) at dist\/docs\/link\.html:4:10\./);
  assert.ok(prompt.includes("Link to /docs/guid.html points to a page that does not exist."), "the message is there");
  assert.ok(prompt.includes("Fix: Point the link at /docs/guide.html."), "the fix hint is there");
  assert.ok(prompt.includes("Edit: on line 4, replace '/docs/guid.html' with '/docs/guide.html'."), "the exact edit is there");
  assert.ok(prompt.includes("The location is the built output"), "the prompt tells the agent the location is built output");
  assert.equal(prompt, findingPrompt(edited, "dist"), "buildReport stores exactly the shared generator's output");
});

test("an edit that needs human input asks for content, a manual fix has no edit sentence", () => {
  const report = sample();
  const alt = report.findings[1]!.prompt!;
  assert.ok(alt.includes("replace '<img src=\"/a.png\">' with content you choose"), "needsInput names the text to change but asks for the replacement");
  assert.ok(!alt.includes("<img src=\"/a.png\" alt=\"\">"), "the content to type is not spelled out when input is needed");
  const apostrophe: Finding = {
    ...edited,
    fix: { kind: "edit", summary: "Say Don't ship broken sites.", edits: [{ file: "docs/link.html", line: 4, action: "replace", find: "watch out", replace: "don't, watch out'..." }], appliesTo: "built-output" },
  };
  const quoted = findingPrompt(apostrophe, ".");
  assert.ok(quoted.includes('"don\'t, watch out\'..."'), "content with a single quote falls back to exact double-quoting");
  const contrast = report.findings[2]!.prompt!;
  assert.ok(contrast.includes("Fix: Darken the text."), "the manual fix hint is there");
  assert.ok(!contrast.includes("Edit:"), "a manual fix carries no exact edit");
  assert.ok(contrast.includes("a11y.color-contrast (note) at dist/docs/link.html (no exact line is known)"), "a location without a line says so");
  assert.ok(contrast.includes("The line is approximate"), "an approximate line says so");
});

test("the report prompt lists every finding in report order", () => {
  const report = sample();
  const lines = report.prompt!.split("\n");
  assert.equal(lines.length, findings.length + 1, "an instruction line and one line per finding");
  assert.ok(lines[0]!.startsWith("Fix every Seaworthy finding below, in the order given."), "the instruction comes first");
  assert.ok(lines[0]!.includes("built output (dist)"), "the prompt says the locations are built output");
  assert.ok(lines[0]!.includes("run seaworthy verify dist"), "the root the user gave is the command to re-run");
  assert.deepEqual(lines.slice(1).map((l, i) => l.slice(0, `${i + 1}. `.length)), findings.map((_, i) => `${i + 1}. `), "findings are numbered consecutively");
  assert.ok(lines[1]!.includes("dist/docs/link.html:4:10 links.internal (error)"), "each line names the location and the check");
  assert.ok(lines[1]!.includes("Fix: Point the link at /docs/guide.html."), "each line carries the fix hint");
  assert.ok(lines[3]!.includes("Fix: Darken the text."), "the last line is the last finding in report order");
});

test("prompts are deterministic: rebuilding gives identical strings", () => {
  assert.equal(reportToJson(sample()), reportToJson(sample()), "the JSON report is byte-identical between builds");
});

test("with root dot, paths and the command stand on their own", () => {
  const report = sample(".");
  assert.ok(report.findings[0]!.prompt!.includes("Check links.internal (error) at docs/link.html:4:10"), "no root prefix when verify ran in place");
  assert.ok(!report.prompt!.includes("seaworthy verify ."), "the dot is not printed as an argument");
  assert.ok(report.prompt!.includes("run seaworthy verify and"), "the plain command is there");
});

test("prompts are generated from finding data alone and leak no private run state", () => {
  const report = sample("dist");
  const all = [report.prompt!, ...report.findings.map((f) => f.prompt!)];
  for (const prompt of all) {
    for (const privateWord of ["suppressed", "baselin", "fingerprint", "on purpose"]) assert.ok(!prompt.includes(privateWord), `"${privateWord}" stays out of the prompt`);
    assert.ok(!prompt.includes("dddddddd44444444"), "the suppressed finding's fingerprint stays out");
    assert.ok(!prompt.includes("\\"), "no backslashes, so the prompt is the same on every platform");
    assert.ok(!/^([a-zA-Z]:)?[\\/]/.test(prompt), "no absolute path when the root is relative");
  }
  assert.deepEqual(reportErrors(report), [], "a report with prompts still conforms to the report schema");
});

test("the per-finding prompts and the report prompt pass through every output format", () => {
  const report = sample();
  const json = reportToJson(report);
  const pretty = formatPretty(report);
  const markdown = formatMarkdown(report);
  const sarif = toSarif(report) as Record<string, any>;
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed.findings.map((f: { prompt: string }) => f.prompt), report.findings.map((f) => f.prompt), "JSON carries each finding prompt verbatim");
  assert.equal(parsed.prompt, report.prompt, "JSON carries the report prompt verbatim");
  assert.deepEqual(reportErrors(parsed), []);
  for (const text of [pretty, markdown]) {
    for (const prompt of [report.prompt!, ...report.findings.map((f) => f.prompt!)]) {
      for (const line of prompt.split("\n")) assert.ok(text.includes(line), `every prompt line appears verbatim: ${line.slice(0, 40)}`);
    }
  }
  assert.ok(pretty.includes("          prompt: Fix this Seaworthy finding"), "the pretty format indents the prompt like the fix line");
  assert.ok(pretty.includes("Prompt to fix every finding at once (paste it into an agent):"), "the pretty format names the report prompt");
  assert.ok(markdown.includes("  - Prompt: Fix this Seaworthy finding"), "the markdown format nests the prompt under its fix bullet");
  assert.ok(markdown.includes("**Prompt for the whole report**"), "the markdown format names the report prompt");
  for (const [index, finding] of report.findings.entries()) assert.equal(sarif.runs[0].results[index].properties.fixPrompt, finding.prompt, "SARIF results carry the finding prompt");
  assert.equal(sarif.runs[0].properties.prompt, report.prompt, "SARIF carries the report prompt on the run");
  assert.deepEqual(sarifErrors(toSarif(report)), [], "a SARIF log with prompts still conforms to the official schema");
});

test("empty reports print no prompts in any format", () => {
  const report = buildReport({ root: ".", pages: 0, checks: [], findings: [] });
  for (const text of [reportToJson(report), formatPretty(report), formatMarkdown(report)]) assert.ok(!text.includes("Fix every Seaworthy"), "no report prompt section");
  const sarif = toSarif(report) as Record<string, any>;
  assert.equal("properties" in sarif.runs[0], false, "no run properties without prompts");
});

test("--format json and --format pretty work end to end with prompts", async () => {
  const cwd = makeSite({ "dist/docs/link.html": PAGE });
  const e2e: Check[] = [
    {
      meta: { id: "links.internal", title: "Link points nowhere", severity: "error", needs: ["html"], docs: "https://example.test/links.internal", standards: [] },
      run: () => [{ message: edited.message, location: edited.location, fix: edited.fix, key: "/docs/guid.html" }],
    },
  ];
  const json = JSON.parse((await run(["verify", "dist", "--format", "json"], { cwd, checks: e2e })).stdout);
  assert.deepEqual(reportErrors(json), []);
  assert.ok(json.findings[0].prompt.includes("Check links.internal (error) at dist/docs/link.html:4:10"), "the JSON findings carry prompts");
  assert.ok(json.prompt.includes("Fix every Seaworthy finding below"), "the JSON report carries the report prompt");
  const pretty = (await run(["verify", "dist", "--format", "pretty"], { cwd, checks: e2e })).stdout;
  assert.ok(pretty.includes("prompt: Fix this Seaworthy finding. Check links.internal"), "the pretty output shows the per-finding prompt");
  assert.ok(pretty.includes("Prompt to fix every finding at once (paste it into an agent):"), "the pretty output offers the whole-report prompt");
});
