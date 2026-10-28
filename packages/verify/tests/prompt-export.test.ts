// `--format prompt`: one copy-pasteable prompt that fixes every finding, grouped
// by file (fewest findings first) so an agent opens each file once and works
// through the list in order. Built on the #264 prompt machinery; the machine
// formats stay untouched.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { run, EXIT } from "../src/cli.js";
import { formatMarkdown } from "../src/formats/markdown.js";
import { formatPrompt } from "../src/formats/prompt.js";
import { formatPretty } from "../src/formats/pretty.js";
import { toSarif } from "../src/formats/sarif.js";
import { buildReport, reportToJson } from "../src/report.js";
import type { Check, Finding } from "../src/types.js";
import { makeSite, reportErrors, sarifErrors } from "./helpers.js";

const check = (id: string, severity: "error" | "warning" | "note"): Check => ({
  meta: { id, title: `title of ${id}`, severity, needs: ["html"], docs: `https://example.test/${id}`, standards: [] },
  run: () => [],
});
const checks: Check[] = [check("a.b", "error"), check("meta.title", "warning"), check("links.internal", "error"), check("images.alt", "warning"), check("a11y.color-contrast", "note")];

/** The probe findings live on two files that tie at two findings each, entered out of line order on purpose. */
const probe = (file: string, line: number, fingerprint: string): Finding => ({
  checkId: "a.b",
  severity: "error",
  message: `Problem on ${file} line ${line}.`,
  location: { file, line },
  fix: { kind: "manual", summary: `Fix ${file} line ${line}.`, edits: [], appliesTo: "built-output" },
  fingerprint,
});

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

const title: Finding = {
  checkId: "meta.title",
  severity: "warning",
  message: "Page has no title.",
  location: { file: "index.html", line: 1, column: 1 },
  fix: { kind: "manual", summary: "Add a title that names the page.", edits: [], appliesTo: "built-output" },
  fingerprint: "dedededed4444444",
};

// Entry order is deliberately NOT group order: buildReport sorts by file and line,
// and the grouped prompt re-orders by (count ascending, file path) after that.
const findings: Finding[] = [
  manual,
  needsInput,
  probe("z.html", 2, "9999999990000002"),
  title,
  probe("z.html", 1, "9999999990000001"),
  edited,
  probe("a.html", 9, "9999999990000009"),
  probe("a.html", 2, "9999999990000004"),
];

const sample = (root = "dist"): ReturnType<typeof buildReport> => buildReport({ root, pages: 4, checks, findings });

const EXPECTED = [
  "Fix every Seaworthy finding below, grouped by file so you open each file once. Files with the fewest findings come first; within a file, findings are in line order. Each location is the built output (dist), so apply the same fix in the source that generates it, rebuild once at the end, then run seaworthy verify dist and confirm every finding is gone.",
  "",
  "dist/index.html — 1 finding",
  "- dist/index.html:1:1 meta.title (warning): Page has no title. Fix: Add a title that names the page.",
  "",
  "dist/a.html — 2 findings",
  "- dist/a.html:2 a.b (error): Problem on a.html line 2. Fix: Fix a.html line 2.",
  "- dist/a.html:9 a.b (error): Problem on a.html line 9. Fix: Fix a.html line 9.",
  "",
  "dist/z.html — 2 findings",
  "- dist/z.html:1 a.b (error): Problem on z.html line 1. Fix: Fix z.html line 1.",
  "- dist/z.html:2 a.b (error): Problem on z.html line 2. Fix: Fix z.html line 2.",
  "",
  "dist/docs/link.html — 3 findings",
  "- dist/docs/link.html:4:10 links.internal (error): Link to /docs/guid.html points to a page that does not exist. Fix: Point the link at /docs/guide.html. Edit: on line 4, replace '/docs/guid.html' with '/docs/guide.html'.",
  "- dist/docs/link.html:5 images.alt (warning): <img src=\"/a.png\"> has no alt attribute. Fix: Add alt text. Edit: on line 5, replace '<img src=\"/a.png\">' with content you choose.",
  "- dist/docs/link.html a11y.color-contrast (note): Low contrast. Fix: Darken the text. The line is approximate; confirm it in the file before editing.",
].join("\n") + "\n";

test("the export is one prompt, grouped by file, fewest findings first, lines in line order", () => {
  assert.equal(formatPrompt(sample()), EXPECTED);
});

test("the export is deterministic: rebuilding and re-rendering give identical bytes", () => {
  assert.equal(formatPrompt(buildReport({ root: "dist", pages: 4, checks, findings })), EXPECTED);
  assert.equal(formatPrompt(sample()), formatPrompt(sample()), "two renders of the same report are identical");
});

test("with root dot, the header and paths stand on their own", () => {
  const prompt = formatPrompt(sample("."));
  assert.ok(prompt.includes("Each location is the built output the verification ran on"), "the built-output phrase adapts to a plain root");
  assert.ok(prompt.includes("then run seaworthy verify and confirm"), "the plain verify command, without the dot");
  assert.ok(!prompt.startsWith("dist") && prompt.includes("index.html — 1 finding") && !prompt.includes("dist/index.html"), "no root prefix when verify ran in place");
});

test("a single finding and an empty report still export one pasteable block", () => {
  const report = buildReport({ root: ".", pages: 1, checks, findings: [edited] });
  assert.equal(formatPrompt(report), [
    "Fix every Seaworthy finding below, grouped by file so you open each file once. Files with the fewest findings come first; within a file, findings are in line order. Each location is the built output the verification ran on, so apply the same fix in the source that generates it, rebuild once at the end, then run seaworthy verify and confirm every finding is gone.",
    "",
    "docs/link.html — 1 finding",
    "- docs/link.html:4:10 links.internal (error): Link to /docs/guid.html points to a page that does not exist. Fix: Point the link at /docs/guide.html. Edit: on line 4, replace '/docs/guid.html' with '/docs/guide.html'.",
  ].join("\n") + "\n");
  const empty = buildReport({ root: ".", pages: 0, checks: [], findings: [] });
  assert.equal(formatPrompt(empty), "No Seaworthy findings. Nothing to fix; run seaworthy verify to confirm.\n");
});

test("the export names no private run state", () => {
  const prompt = formatPrompt(sample("dist"));
  for (const privateWord of ["suppressed", "baselin", "fingerprint", "999999"]) assert.ok(!prompt.includes(privateWord), `"${privateWord}" stays out of the export`);
});

test("the export changes no machine format: the report bytes and the #264 prompts are untouched", () => {
  const one = sample();
  const twice = sample();
  const jsonOne = reportToJson(one);
  assert.equal(jsonOne, reportToJson(twice), "the JSON report is byte-identical between builds");
  const pretty = formatPretty(one);
  const markdown = formatMarkdown(one);
  assert.ok(pretty.includes("Prompt to fix every finding at once"), "the #264 whole-report prompt is still in pretty");
  assert.ok(markdown.includes("Prompt for the whole report"), "the #264 whole-report prompt is still in markdown");
  for (const text of [pretty, markdown]) {
    assert.ok(!text.includes("grouped by file"), "the export prompt adds nothing to a human format");
  }
  assert.ok(jsonOne.includes('"prompt": "Fix every Seaworthy finding below, in the order given.'), "the report-order prompt is unchanged in JSON");
  const sarif = toSarif(twice) as Record<string, any>;
  assert.equal(sarif.runs[0].results.length, one.findings.length, "SARIF carries every finding exactly once");
  assert.deepEqual(sarifErrors(toSarif(twice)), [], "a SARIF log near the export still conforms to the official schema");
  assert.ok(!JSON.parse(jsonOne).prompt.includes("grouped by file"), "the JSON prompt stays the #264 report-order prompt");
});

test("--format prompt works end to end with real checks", async () => {
  const cwd = makeSite({ "dist/one.html": '<!doctype html>\n<html lang="en"><head><title>t</title></head><body><a href="/gone.html">x</a></body></html>\n' });
  const e2e: Check[] = [
    {
      meta: { id: "a.two", title: "two findings in the only file", severity: "error", needs: ["html"], docs: "https://example.test/a.two", standards: [] },
      run: () => [3, 4].map((line) => ({ message: `finding on line ${line}`, location: { file: "one.html", line }, fix: { kind: "manual" as const, summary: `fix line ${line}` }, key: `n${line}` })),
    },
  ];
  const pasted = await run(["verify", "dist", "--format", "prompt"], { cwd, checks: e2e });
  assert.equal(pasted.code, EXIT.findings, "findings still decide the exit code");
  const written = await run(["verify", "dist", "--format", "prompt", "--out", "reports/prompt.txt"], { cwd, checks: e2e });
  assert.match(written.stdout, /^seaworthy: 2 findings \(2 errors\); prompt report written to reports\/prompt\.txt\n$/);
  assert.equal(readFileSync(join(cwd, "reports", "prompt.txt"), "utf8"), pasted.stdout, "the --out file is exactly what an agent pastes");
  assert.match(pasted.stdout, /^Fix every Seaworthy finding below, grouped by file so you open each file once/);
  assert.match(pasted.stdout, /dist\/one\.html — 2 findings/);
  assert.match(pasted.stdout, /- dist\/one\.html:3 a\.two \(error\): finding on line 3 Fix: fix line 3$/m);
  assert.match(pasted.stdout, /run seaworthy verify dist and confirm every finding is gone/);
});

test("the CLI surfaces are consistent: machine formats byte-identical across runs, help and errors list prompt", async () => {
  const cwd = makeSite({ "dist/index.html": '<!doctype html>\n<html lang="en"><head><title>t</title></head><body><a href="/gone.html">x</a></body></html>\n' });
  const check: Check = {
    meta: { id: "a.one", title: "one finding per page", severity: "error", needs: ["html"], docs: "https://example.test/a.one", standards: [] },
    run: (ctx) => [...ctx.site.pages.values()].map((page) => ({ message: "one finding", location: { file: page.file, line: 3, column: 7 }, fix: { kind: "manual" as const, summary: "fix it" }, key: page.url })),
  };
  const once = await run(["verify", "dist", "--format", "json"], { cwd, checks: [check] });
  const again = await run(["verify", "dist", "--format", "json"], { cwd, checks: [check] });
  assert.equal(once.stdout, again.stdout, "the machine format is byte-identical across runs");
  assert.deepEqual(reportErrors(JSON.parse(once.stdout)), [], "the JSON report still conforms to the report schema");
  assert.ok(!once.stdout.includes("grouped by file"), "the export prompt stays out of the machine format");
  assert.match((await run(["--help"])).stdout, /json, markdown, sarif, llm, prompt, or html/);
  const bad = await run(["verify", "dist", "--format", "xml"]);
  assert.equal(bad.code, EXIT.usage);
  assert.match(bad.stderr, /use html, json, llm, markdown, pretty, prompt, sarif/);
});
