// The `--format html` report: one self-contained page for people, with filters.
// Covers determinism, self-containment (no external requests), escaping of
// untrusted site/check text, and that the machine-readable formats are untouched.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PLAIN } from "../src/color.js";
import { EXIT, run } from "../src/cli.js";
import { FORMATS, formatReport } from "../src/formats/index.js";
import { formatHtml } from "../src/formats/html.js";
import { formatMarkdown } from "../src/formats/markdown.js";
import { reportToJson } from "../src/report.js";
import { formatSarif } from "../src/formats/sarif.js";
import { formatPretty } from "../src/formats/pretty.js";
import { runChecks } from "../src/engine.js";
import { buildReport } from "../src/report.js";
import { appendHistory, HISTORY_DIR, type HistoryRecord } from "../src/history.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding, Report, Severity } from "../src/types.js";
import { makeSite, reportErrors } from "./helpers.js";

const PAGE = "<!doctype html>\n<html lang=\"en\"><head><title>t</title></head>\n<body>\n<a href=\"/missing.html\">Guide</a>\n<img src=\"/a.png\">\n<p class=\"muted\">low</p>\n</body></html>\n";

const check = (id: string, severity: Severity, drafts: Check["run"]): Check => ({
  meta: { id, title: `title of ${id}`, severity, needs: ["html"], docs: `https://example.test/${id}`, standards: [] },
  run: drafts,
});

const CHECKS: Check[] = [
  check("links.internal", "error", () => [
    {
      message: "Link to /missing.html points to a page that does not exist.",
      location: { file: "index.html", line: 4, column: 10 },
      fix: { kind: "edit", summary: "Point the link at /found.html.", edits: [] },
      key: "/missing.html",
    },
  ]),
  check("images.alt", "warning", () => [
    {
      message: "<img> has no alt attribute.",
      location: { file: "index.html", line: 5 },
      fix: { kind: "edit", summary: "Add alt text.", edits: [] },
      key: "/a.png",
    },
    {
      message: "<img> in about.html has no alt attribute.",
      location: { file: "about.html", line: 5 },
      fix: { kind: "edit", summary: "Add alt text.", edits: [] },
      key: "/a.png",
    },
  ]),
  check("a11y.color-contrast", "note", () => [
    { message: "Low contrast.", location: { file: "index.html", line: 6, column: 4 }, fix: { kind: "manual", summary: "Darken the text." }, key: "p.muted" },
  ]),
];

async function sample(): Promise<Report> {
  const site = buildSite(makeSite({ "dist/index.html": PAGE, "dist/about.html": PAGE }));
  const result = await runChecks({ site, checks: CHECKS });
  const report = buildReport({ root: "dist", pages: site.pages.size, checks: CHECKS, findings: result.findings, skipped: result.skipped, errors: result.errors });
  assert.deepEqual(reportErrors(report), []);
  return report;
}

test("the same report gives byte-identical HTML, every time and via formatReport", async () => {
  const report = await sample();
  assert.equal(formatHtml(report), formatHtml(report));
  assert.equal(formatReport(report, "html"), formatHtml(report));
});

test("the page is self-contained: no external requests, no scripts or assets from elsewhere", async () => {
  const html = formatHtml(await sample());
  for (const pattern of [/<link\b/, /<img\b/, /<iframe\b/, /<object\b/, /<embed\b/, /@import\b/, /fetch\(/, /XMLHttpRequest/, /\bimport\(/, /https?:\/\//]) {
    assert.doesNotMatch(html, pattern, `the page must not contain ${pattern}`);
  }
  // The one script element is the filter code itself, written inline.
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
});

test("the page shows summary counts, then findings grouped by file and check", async () => {
  const html = formatHtml(await sample());
  assert.match(html, /<title>Seaworthy [^<]*: dist — 4 findings<\/title>/);
  assert.match(html, /\b4 findings\b/);
  assert.match(html, /<span class="error">1 error<\/span>/);
  assert.match(html, /<span class="warn">2 warnings<\/span>/);
  assert.match(html, /<span class="note">1 note<\/span>/);
  assert.equal((html.match(/<section class="file">/g) ?? []).length, 2, "one group per file");
  assert.equal((html.match(/<section class="check">/g) ?? []).length, 4, "one subgroup per check inside a file");
  assert.match(html, /<h2><code>index\.html<\/code><span class="count">3 findings<\/span><\/h2>/);
  assert.match(html, /<code>links\.internal<\/code>/);
  assert.match(html, /<code class="loc">4:10<\/code>/, "the location is on the row");
  assert.equal((html.match(/<li class="finding /g) ?? []).length, 4);
});

test("every finding row carries its severity, check, and file data attributes", async () => {
  const html = formatHtml(await sample());
  assert.match(html, /<li class="finding error" data-sev="error" data-check="links\.internal" data-file="index\.html">/);
  assert.match(html, /<li class="finding warn" data-sev="warning" data-check="images\.alt" data-file="about\.html">/);
  assert.match(html, /<li class="finding note" data-sev="note" data-check="a11y\.color-contrast" data-file="index\.html">/);
});

test("filters are plain HTML and vanilla JS wired to the row data attributes", async () => {
  const html = formatHtml(await sample());
  for (const id of ["id=\"filter-check\"", "id=\"filter-file\"", "id=\"filter-status\""]) {
    assert.ok(html.includes(id), `the page has a ${id} control`);
  }
  for (const sev of ["all", "error", "warning", "note"]) {
    assert.ok(html.includes(`data-sev="${sev}"`), `the page has a ${sev} severity filter`);
  }
  assert.match(html, /addEventListener\("input", apply\)/);
  assert.match(html, /addEventListener\("click"/);
  assert.match(html, /dataCheck\.indexOf\(check\)/, "the check filter matches a substring");
  assert.match(html, /dataFile\.indexOf\(file\)/, "the file filter matches a substring");
});

test("a clean report is an all-clear page with no filters and no script", () => {
  const report = buildReport({ root: ".", pages: 1, checks: [], findings: [] });
  const html = formatHtml(report);
  assert.match(html, /No findings\./);
  assert.ok(!html.includes("id=\"filters\""));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<main"));
});

test("skipped checks and crashed checks get their own sections", async () => {
  const site = buildSite(makeSite({ "index.html": PAGE }));
  const rendered: Check = { meta: { id: "a11y.x", title: "needs a browser", severity: "error", needs: ["html", "browser"], docs: "https://example.test/x", standards: [] }, run: () => [] };
  const crashing: Check = { meta: { id: "x.crash", title: "crashes", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] }, run() { throw new Error("boom"); } };
  const result = await runChecks({ site, checks: [crashing, rendered, ...CHECKS] });
  const report = buildReport({ root: "site", pages: site.pages.size, checks: [crashing, rendered, ...CHECKS], findings: result.findings, skipped: result.skipped, errors: result.errors });
  const html = formatHtml(report);
  assert.match(html, /<h2>Skipped, not run<\/h2>/);
  assert.match(html, /<code>a11y\.x<\/code>/);
  assert.match(html, /<h2>Check errors, these checks crashed<\/h2>/);
  assert.match(html, /<code>x\.crash<\/code>: boom/);
});

// Malicious fixture: the text a site or a check can influence must never reach
// the page as markup. `<`, `>`, `&`, and quotes all stay escaped everywhere.
const EVIL_MESSAGE = "<script>alert(1)</script> <img src=x onerror=alert(2)> &amp; <b>bold</b>";
const EVIL_FILE = '"><img src=y onerror=alert(3)>.html';
const evil: Check = {
  meta: { id: "evil.check", title: "<b title=na>check &amp; <i>not</i></b>", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: () => [],
};

function evilReport(): Report {
  const finding: Finding = {
    checkId: "evil.check",
    severity: "error",
    message: EVIL_MESSAGE,
    location: { file: EVIL_FILE, line: 1, column: 1 },
    fix: { kind: "manual", summary: `<img src=z onerror=alert(4)> & "quotes" 'single'`, edits: [], appliesTo: "built-output" },
    fingerprint: "f",
  };
  return buildReport({ root: "site", pages: 1, checks: [evil], findings: [finding] });
}

/** Every element name that appears in the generated page. */
const TAGS = new Set([
  "html", "head", "meta", "title", "style", "body", "header", "h1", "h2", "h3", "p", "code", "span",
  "fieldset", "legend", "button", "label", "input", "main", "section", "ul", "li", "details", "summary",
  "pre", "footer", "script",
]);

test("a malicious finding cannot escape into markup", async () => {
  const html = formatHtml(evilReport());
  // No element outside the known set: attacker markup never produces tags. The
  // scan reads tag names even when attributes follow (`<meta charset=...>`),
  // and digits count (`h1` is a real element), so nothing slips past.
  const seen = new Set((html.match(/<\/?[a-zA-Z][a-zA-Z0-9]*/g) ?? []).map((tag) => tag.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()));
  assert.deepEqual([...seen].sort(), [...TAGS].sort());
  // The payload arrives as text, not markup.
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(2)&gt;"));
  assert.ok(html.includes("&amp;") || html.includes("&amp;amp;"));
  assert.ok(html.includes("&quot;"), "double quotes are escaped in attributes");
  assert.ok(html.includes("&#39;"), "single quotes are escaped");
  // The file name cannot close its attribute or open new elements.
  assert.ok(html.includes(`data-file="&quot;&gt;&lt;img src=y onerror=alert(3)&gt;.html"`));
});

test("a malicious check title stays text in the group heading", async () => {
  const html = formatHtml(evilReport());
  assert.ok(html.includes("<code>evil.check</code>"));
  assert.ok(html.includes("&lt;b title=na&gt;check &amp;amp; &lt;i&gt;not&lt;/i&gt;&lt;/b&gt;"));
});

test("adding html leaves the machine-readable formats' wiring untouched", async () => {
  const report = await sample();
  assert.deepEqual([...FORMATS], ["html", "json", "llm", "markdown", "ndjson", "pretty", "prompt", "sarif"]);
  assert.equal(formatReport(report, "json"), reportToJson(report));
  assert.equal(formatReport(report, "markdown"), formatMarkdown(report));
  assert.equal(formatReport(report, "sarif"), formatSarif(report, {}));
});

test("--format html runs through the CLI: byte-identical across runs, exit codes unchanged", async () => {
  // Run from inside the site folder, so the report's root label is relative and
  // the page never embeds an absolute path. --no-history keeps the store empty so
  // the trend cannot differ between the runs being compared for byte-identity.
  const site = makeSite({ "index.html": PAGE });
  const once = (): Promise<string> => run(["verify", ".", "--format", "html", "--no-history"], { cwd: site, checks: CHECKS }).then((r) => r.stdout);
  const first = await once();
  const second = await once();
  assert.equal(first, second, "same site, same bytes");
  assert.ok(first.startsWith("<!doctype html>"));
  assert.ok(!first.startsWith(tmpdir()), "no absolute paths in the page");
  assert.equal((await run(["verify", ".", "--format", "html", "--no-history"], { cwd: site, checks: [] })).code, EXIT.ok, "a clean site still exits 0");
  assert.equal((await run(["verify", ".", "--format", "html", "--no-history", "--fail-on", "note"], { cwd: site, checks: CHECKS })).code, EXIT.findings, "--fail-on still applies to html");
  assert.equal((await run(["verify", ".", "--format=html", "--no-history"], { cwd: site, checks: CHECKS })).stdout, first, "--format=html parses the same");
});

test("--format html --out writes the page to a file and keeps stdout a summary", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const result = await run(["verify", "dist", "--format", "html", "--no-history", "--out", "reports/seaworthy.html"], { cwd, checks: CHECKS });
  const page = readFileSync(join(cwd, "reports", "seaworthy.html"), "utf8");
  assert.equal(page, formatHtml(JSON.parse(await run(["verify", "dist", "--format", "json"], { cwd, checks: CHECKS }).then((r) => r.stdout))), "the file is exactly the html report");
  assert.match(result.stdout, /html report written to/);
  assert.match(result.stdout, /4 finding/);
  assert.ok(!result.stdout.includes("<!doctype"), "stdout stays a one-line summary");
  assert.ok(!page.includes("class=\"trend\""), "--out on a fresh folder writes no trend");
});

// The trend: the findings line over the runs already recorded in .seaworthy/history. It is HTML
// only (never the report JSON), reads the store oldest first, caps to the recent ten, and draws
// nothing until there are at least two runs — an empty store or a single point is not a chart.
const record = (started: string, root: string, findings: number, bySeverity: HistoryRecord["counts"]["bySeverity"] = {}): HistoryRecord => ({
  spec: 1,
  tool: "seaworthy",
  started,
  root,
  pages: 1,
  configHash: "a".repeat(64),
  counts: { findings, bySeverity, byCheck: {}, suppressed: 0, baselined: 0, baselineStale: 0, errors: 0 },
});

test("no history and one record render the page exactly as before, with no trend", async () => {
  const report = await sample();
  assert.equal(formatHtml(report, []), formatHtml(report), "an empty store is no trend");
  const one = formatHtml(report, [record("2026-03-01T00:00:00.000Z", "dist", 3)]);
  assert.equal(one, formatHtml(report), "a single run is not a chart");
  assert.ok(!one.includes("class=\"trend\""));
});

test("two or more runs draw a findings trend as inline SVG and a run table", async () => {
  const report = await sample();
  const html = formatHtml(report, [
    record("2026-03-01T00:00:00.000Z", "dist", 4, { error: 1, warning: 2, note: 1 }),
    record("2026-03-02T00:00:00.000Z", "dist", 2, { error: 1, warning: 1 }),
    record("2026-03-03T00:00:00.000Z", "dist", 1, { error: 1 }),
  ]);
  assert.match(html, /<section class="trend">/);
  assert.match(html, /<svg class="spark"/, "the sparkline is an inline SVG");
  assert.match(html, /<polyline class="line"/);
  assert.match(html, /<table>/);
  // One data row per run, oldest first, with the stored counts.
  assert.equal((html.match(/<tr><td class="run">/g) ?? []).length, 3);
  assert.match(html, /<td class="run">2026-03-01T00:00:00\.000Z<\/td>/);
  assert.match(html, /<td>4<\/td><td>1<\/td><td>2<\/td><td>1<\/td>/, "findings, errors, warnings, notes for the first run");
});

test("the trend is deterministic and adds no script, asset, or external request", async () => {
  const report = await sample();
  const runs = [
    record("2026-03-01T00:00:00.000Z", "dist", 4),
    record("2026-03-02T00:00:00.000Z", "dist", 2),
    record("2026-03-03T00:00:00.000Z", "dist", 1),
  ];
  assert.equal(formatHtml(report, runs), formatHtml(report, runs), "same store, same bytes");
  const html = formatHtml(report, runs);
  assert.equal((html.match(/<script>/g) ?? []).length, 1, "the trend adds no JavaScript, only the filter script stays");
  for (const pattern of [/<image\b/, /<iframe\b/, /https?:\/\//, /url\(/]) {
    assert.doesNotMatch(html, pattern, "the trend fetches nothing external");
  }
});

test("the trend caps to the ten most recent runs", async () => {
  const report = await sample();
  const runs = Array.from({ length: 13 }, (_, i) => record(`2026-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, "dist", i));
  const html = formatHtml(report, runs);
  assert.equal((html.match(/<tr><td class="run">/g) ?? []).length, 10, "only the newest ten runs are shown");
  assert.match(html, /2026-03-04T00:00:00\.000Z/, "the oldest three are dropped, the tenth-from-last stays");
  assert.doesNotMatch(html, /2026-03-01T00:00:00\.000Z/, "the very first run is past the cap");
});

test("a root that carries HTML-ish characters stays escaped in the run table", async () => {
  const report = await sample();
  const html = formatHtml(report, [
    record("2026-03-01T00:00:00.000Z", '"><script>alert(1)</script>.html', 4),
    record("2026-03-02T00:00:00.000Z", "dist", 2),
  ]);
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;.html"), "the root is escaped as text");
  assert.ok(!html.includes("<script>alert(1)</script>"), "the root never opens a script element");
});

test("verify --format html reads the runs off disk, and a corrupt record is skipped", async () => {
  const cwd = makeSite({ "index.html": PAGE });
  // Seed two whole runs and one truncated file the reader must ignore.
  appendHistory(cwd, record("2026-03-01T00:00:00.000Z", ".", 5));
  appendHistory(cwd, record("2026-03-02T00:00:00.000Z", ".", 3));
  writeFileSync(join(cwd, HISTORY_DIR, "0003-20260303T000000000Z.json"), '{"spec":1,"star');
  const html = await run(["verify", ".", "--format", "html", "--no-history"], { cwd, checks: CHECKS }).then((r) => r.stdout);
  assert.match(html, /<section class="trend">/, "the two readable runs draw the trend");
  assert.equal((html.match(/<tr><td class="run">/g) ?? []).length, 2, "the corrupt record is skipped, never charted");
});

test("adding the trend leaves the machine-readable formats byte-unchanged", async () => {
  const report = await sample();
  const runs = [record("2026-03-01T00:00:00.000Z", "dist", 4), record("2026-03-02T00:00:00.000Z", "dist", 2)];
  assert.equal(formatReport(report, "json", { history: runs }), reportToJson(report), "json ignores history");
  assert.equal(formatReport(report, "sarif", { history: runs }), formatSarif(report, {}), "sarif ignores history");
  assert.equal(formatReport(report, "pretty", { history: runs }), formatPretty(report, PLAIN), "pretty ignores history");
});
