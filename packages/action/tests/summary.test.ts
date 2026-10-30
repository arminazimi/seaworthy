// Issue #260 (`action.job-summary`): the run page's job summary — the counts the report contract
// carries, the top findings in one frozen order, the crashed checks, and the badge. Every test here
// is offline: a report object in, markdown out, no network, no CLI, and no pull request.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { Finding, Location, Report, Severity } from "@seaworthy/verify";

import { README_SNIPPET, badgeForReport } from "../src/badge-svg.js";
import { SUMMARY_ENV, TOP_FINDINGS, compareTopFindings, escapeCell, inlineCode, jobSummary, topFindings, writeJobSummary } from "../src/summary.js";

const made: string[] = [];
after(() => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});

/** A finding with everything the summary reads filled in; pass what the test cares about. */
function finding(over: { checkId: string; severity: Severity; file: string; message?: string; location?: Partial<Location>; fingerprint?: string }): Finding {
  const { file, location, message, ...rest } = over;
  return {
    message: message ?? `Problem in ${file}.`,
    fix: { kind: "manual", summary: "Fix it.", edits: [], appliesTo: "built-output" },
    fingerprint: rest.fingerprint ?? `fp-${over.checkId}-${file}`,
    ...rest,
    location: { file, line: 3, column: 7, ...location },
  };
}

/** A report as `verify --format json` writes it, with the summary counts an equal findings list gives. */
function report(findings: readonly Finding[], over: Partial<Report["summary"]> = {}): Report {
  const bySeverity: Report["summary"]["bySeverity"] = {};
  for (const severity of ["error", "warning", "note"] as const) {
    const n = findings.filter((f) => f.severity === severity).length;
    if (n > 0) bySeverity[severity] = n;
  }
  return {
    spec: 0,
    tool: { name: "seaworthy", version: "0.0.0" },
    root: "dist",
    summary: { pages: 4, findings: findings.length, bySeverity, suppressed: 0, baselined: 0, baselineStale: 0, ...over },
    checks: [],
    findings: [...findings],
    suppressed: [],
    skipped: [],
    errors: [],
  };
}

/** The data rows of the summary's table: the header and the separator row are not findings. */
const rowsOf = (markdown: string): string[] => markdown.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Severity") && !line.startsWith("| ---"));

/** The cell separators of a markdown table row, ignoring the escaped ones: always 5, whatever the cells hold. */
const separators = (row: string): number => (row.match(/(?<!\\)\|/g) ?? []).length;

test("a clean report renders the counts and no findings section", () => {
  const markdown = jobSummary(report([]));
  assert.match(markdown, /^## Seaworthy\n/);
  assert.match(markdown, /`dist` — 4 pages, no findings\./);
  assert.doesNotMatch(markdown, /Top findings/);
  assert.doesNotMatch(markdown, /Checks that crashed/);
});

test("a named site labels the heading, so several sections in one file stay apart", () => {
  assert.match(jobSummary(report([]), "blog/_site"), /^## Seaworthy · `blog\/_site`\n/);
  assert.match(jobSummary(report([]), ""), /^## Seaworthy\n/, "an empty site is no site: the plain heading");
});

test("every severity the report counts is shown, and one it does not count is absent rather than 0", () => {
  const all = jobSummary(report([finding({ checkId: "html.charset", severity: "error", file: "a.html" }), finding({ checkId: "images.alt", severity: "warning", file: "b.html" }), finding({ checkId: "meta.description", severity: "note", file: "c.html" })]));
  assert.match(all, /3 findings: 1 error, 1 warning, 1 note\./);

  // A report with no errors carries no `error` key at all (spec/report/fragments/summary/bySeverity);
  // the summary must not invent "0 errors".
  const warnings = jobSummary(report([finding({ checkId: "images.alt", severity: "warning", file: "b.html" })]));
  assert.match(warnings, /1 warning/);
  assert.doesNotMatch(warnings, /0 error/);
});

test("a summary number the report does not carry contributes no number", () => {
  const { summary, ...rest } = report([finding({ checkId: "html.charset", severity: "error", file: "a.html" })]);
  const partial = { ...rest, summary: { findings: summary.findings, bySeverity: summary.bySeverity, suppressed: 0, baselined: 0, baselineStale: 0 } };
  const markdown = jobSummary(partial);
  assert.doesNotMatch(markdown, /pages/);
  assert.match(markdown, /`dist` — 1 finding: 1 error\./);
});

test("the optional summary notes appear only when the report carries them", () => {
  const markdown = jobSummary(report([finding({ checkId: "html.charset", severity: "error", file: "a.html" })], { suppressed: 2, baselined: 1, baselineStale: 3, findingsOmitted: 40, changedFiles: 5, readability: { score: 60, checks: 5, passed: 3, withFindings: 2 } }));
  assert.match(markdown, /- 2 findings suppressed on purpose\./);
  assert.match(markdown, /- 1 finding accepted by the baseline\./);
  assert.match(markdown, /- 3 baseline entries fixed/);
  assert.match(markdown, /- 40 more findings are left out of this report/);
  assert.match(markdown, /- Findings are limited to the 5 files that changed\./);
  assert.match(markdown, /- Agent readability: 60\/100 \(3 of 5 applicable checks clean\)\./);

  const quiet = jobSummary(report([finding({ checkId: "html.charset", severity: "error", file: "a.html" })]));
  assert.doesNotMatch(quiet, /suppressed|baseline|left out|readability|changed/);
});

test("the top findings are worst first: severity, then check ID, then location", () => {
  const findings = [
    finding({ checkId: "zzz.last", severity: "note", file: "a.html" }),
    finding({ checkId: "images.alt", severity: "warning", file: "b.html" }),
    finding({ checkId: "links.internal", severity: "error", file: "z.html", location: { file: "z.html", line: 9 } }),
    finding({ checkId: "html.charset", severity: "error", file: "a.html" }),
    finding({ checkId: "html.charset", severity: "error", file: "b.html", location: { file: "b.html", line: 1, column: 2 } }),
    finding({ checkId: "html.charset", severity: "error", file: "b.html", location: { file: "b.html", line: 1, column: 4 } }),
  ];
  const ordered = topFindings(findings).map((f) => `${f.severity} ${f.checkId} ${f.location.file} ${f.location.line}:${f.location.column}`);
  assert.deepEqual(ordered, [
    "error html.charset a.html 3:7",
    "error html.charset b.html 1:2",
    "error html.charset b.html 1:4",
    "error links.internal z.html 9:7",
    "warning images.alt b.html 3:7",
    "note zzz.last a.html 3:7",
  ]);
  const markdown = jobSummary(report(findings));
  assert.deepEqual(rowsOf(markdown).map((row) => row.split(/(?<!\\)\|/)[2]?.trim()), ["`html.charset`", "`html.charset`", "`html.charset`", "`links.internal`", "`images.alt`", "`zzz.last`"]);
  assert.deepEqual(rowsOf(markdown).map((row) => row.split(/(?<!\\)\|/)[1]?.trim()), ["error", "error", "error", "error", "warning", "note"]);
});

test("the tie case: equal severity, check, file, line and column fall back to the fingerprint, then to the report's own order", () => {
  const a = finding({ checkId: "html.charset", severity: "error", file: "a.html", fingerprint: "aaa" });
  const b = finding({ checkId: "html.charset", severity: "error", file: "a.html", fingerprint: "bbb" });
  assert.equal(compareTopFindings(a, b), -1);
  assert.equal(compareTopFindings(b, a), 1);
  // Identical in every field the rule reads: the sort is stable, so the report order decides.
  assert.equal(compareTopFindings(a, { ...a }), 0);
  assert.deepEqual(topFindings([b, a, { ...a }]).map((f) => f.fingerprint), ["aaa", "aaa", "bbb"]);
  // A finding with no line sorts after one that has a line: it cannot be placed on the page.
  // Built without the helper, which always fills a line in.
  const noLine: Finding = { ...a, location: { file: "a.html", column: 1 } };
  assert.equal(compareTopFindings(a, noLine), -1);
});

test("the list is capped and the remainder is a count, never a silent drop", () => {
  const findings = Array.from({ length: TOP_FINDINGS + 3 }, (_, i) => finding({ checkId: "links.internal", severity: "error", file: `p${String(i).padStart(2, "0")}.html` }));
  const markdown = jobSummary(report(findings));
  assert.equal(rowsOf(markdown).length, TOP_FINDINGS);
  assert.match(markdown, /At most 10 are listed\./);
  assert.match(markdown, /\.\.\.and 3 more findings\. Run `seaworthy verify --format json` for the full report\./);
});

test("a `|`, a backtick or a newline in a message or a path cannot break the table", () => {
  const findings = [
    finding({ checkId: "html.charset", severity: "error", file: "a.html", message: "Two cells | one row" }),
    finding({ checkId: "images.alt", severity: "warning", file: "b`c.html", message: "A `code span` in the message" }),
    finding({ checkId: "links.internal", severity: "note", file: "d|e.html", message: "First line\nsecond line\r\nthird line" }),
  ];
  const markdown = jobSummary(report(findings));
  const table = rowsOf(markdown);
  assert.equal(table.length, 3);
  for (const row of table) assert.equal(separators(row), 5, "a row must have exactly five cell separators: " + row);
  assert.ok(markdown.includes("Two cells \\| one row"), "a pipe is escaped, not a new cell");
  assert.ok(markdown.includes("A \\`code span\\` in the message"), "a backtick is escaped where it would otherwise open a code span");
  assert.ok(markdown.includes("First line second line third line"), "newlines become spaces");
  assert.match(markdown, /`b'c\.html:3:7`/, "a backtick in a path is replaced inside a code span, as the Markdown report does");
  assert.ok(markdown.includes("`d\\|e.html:3:7`"), "a pipe in a path is escaped: a table row is split before inline parsing");
  assert.equal(escapeCell("a | b\nc"), "a \\| b c");
  assert.equal(escapeCell("a `b"), "a \\`b");
  assert.equal(inlineCode("a`b\nc"), "`a'b c`");
  assert.equal(inlineCode("a|b"), "`a\\|b`");
});

test("crashed checks are listed, escaped like any other cell", () => {
  const broken = report([finding({ checkId: "html.charset", severity: "error", file: "a.html" })]);
  broken.errors = [{ check: "links.internal", message: "exploded | badly" }];
  const markdown = jobSummary(broken);
  assert.match(markdown, /### Checks that crashed/);
  assert.ok(markdown.includes("- `links.internal`: exploded \\| badly"));
});

test("the badge section shows the state the report already maps to and the README snippet the package ships", () => {
  const failing = report([finding({ checkId: "html.charset", severity: "error", file: "a.html" })]);
  const markdown = jobSummary(failing);
  assert.equal(badgeForReport(failing).state, "failing");
  assert.ok(markdown.includes(README_SNIPPET), "the one snippet from badge-svg.ts, byte for byte");
  assert.match(markdown, /builds from this report: `failing` \(1\)\./);
  assert.ok(markdown.includes("```markdown\n" + README_SNIPPET + "\n```"), "shown as copyable text, not as a broken image");
  assert.ok(markdown.indexOf("### Badge") < markdown.indexOf("_Seaworthy is pre-alpha"), "the badge sits before the footer");
  assert.match(jobSummary(report([])), /builds from this report: `passing`\./);
});

test("a malformed or foreign JSON report renders nothing at all", () => {
  assert.equal(jobSummary(undefined), "");
  assert.equal(jobSummary({}), "");
  assert.equal(jobSummary(JSON.stringify({ root: "dist" })), "");
  assert.equal(jobSummary({ tool: { name: "other", version: "1" }, root: "dist", summary: {}, findings: [] }), "");
  // A report with a damaged finding keeps the summary, minus the row it cannot describe.
  const damaged = report([finding({ checkId: "html.charset", severity: "error", file: "a.html" })]) as unknown as { findings: unknown[] };
  damaged.findings.push({ checkId: "nope", severity: "critical", message: "not a finding", location: {} });
  assert.equal(rowsOf(jobSummary(damaged)).length, 1);
});

test("the same report always renders the same bytes, whatever order the findings arrive in", () => {
  const findings = [
    finding({ checkId: "images.alt", severity: "warning", file: "b.html" }),
    finding({ checkId: "html.charset", severity: "error", file: "a.html" }),
    finding({ checkId: "links.internal", severity: "error", file: "z.html" }),
    finding({ checkId: "meta.viewport", severity: "note", file: "c.html" }),
  ];
  const once = jobSummary(report(findings));
  assert.equal(once, jobSummary(report(findings)));
  assert.equal(once, jobSummary(report([...findings].reverse())));
  assert.ok(once.endsWith("\n"));
});

test("writeJobSummary appends to the file the runner names, and never throws", () => {
  const root = mkdtempSync(join(tmpdir(), "seaworthy-summary-"));
  made.push(root);
  const file = join(root, "step-summary.md");
  writeFileSync(file, "## From an earlier step\n");
  const markdown = jobSummary(report([finding({ checkId: "html.charset", severity: "error", file: "a.html" })]));

  assert.equal(SUMMARY_ENV, "GITHUB_STEP_SUMMARY");
  assert.equal(writeJobSummary(markdown, { GITHUB_STEP_SUMMARY: file }), true);
  assert.equal(writeJobSummary(markdown, { [SUMMARY_ENV]: file }), true);
  const written = readFileSync(file, "utf8");
  assert.ok(written.startsWith("## From an earlier step\n"), "a job summary is appended, not replaced: other steps own the file too");
  assert.equal(written.split("## Seaworthy\n").length - 1, 2, "both writes are in the file");

  // No file named, nothing to write; a failed write is a false, never an exception.
  assert.equal(writeJobSummary(markdown, {}), false);
  assert.equal(writeJobSummary(markdown, { GITHUB_STEP_SUMMARY: "" }), false);
  assert.equal(writeJobSummary("", { GITHUB_STEP_SUMMARY: file }), false);
  assert.equal(writeJobSummary(markdown, { GITHUB_STEP_SUMMARY: join(root, "gone", "summary.md") }), false);
  assert.equal(writeJobSummary(markdown, { GITHUB_STEP_SUMMARY: root }), false, "a folder is not a summary file");
  assert.equal(readFileSync(file, "utf8"), written, "the failed writes changed nothing");
});
