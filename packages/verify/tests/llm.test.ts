import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli.js";
import { formatLlm } from "../src/formats/llm.js";
import { buildReport } from "../src/report.js";
import { makeSite, reportErrors } from "./helpers.js";
import type { Check, FindingDraft } from "../src/types.js";

const checks: Check[] = [
  {
    meta: { id: "links.internal", title: "title of links.internal", severity: "error", needs: ["html"], docs: "https://example.test/links.internal", standards: [] },
    run: (): FindingDraft[] => [
      {
        message: "Link to /docs/guid.html points to a page that does not exist.",
        location: { file: "index.html", line: 4, column: 10 },
        fix: { kind: "edit", summary: "Point the link at /docs/guide.html.", edits: [{ file: "index.html", line: 4, action: "replace", find: "/docs/guid.html", replace: "/docs/guide.html" }] },
        key: "/docs/guid.html",
      },
    ],
  },
  {
    meta: { id: "images.alt", title: "title of images.alt", severity: "warning", needs: ["html"], docs: "https://example.test/images.alt", standards: [] },
    run: (): FindingDraft[] => [{ message: "<img> has no alt attribute.", location: { file: "index.html", line: 5 }, fix: { kind: "edit", summary: "Add alt text." }, key: "/a.png" }],
  },
  {
    meta: { id: "a11y.color-contrast", title: "title of a11y.color-contrast", severity: "note", needs: ["html"], docs: "https://example.test/a11y.color-contrast", standards: [] },
    run: (): FindingDraft[] => [{ message: "Low contrast.", location: { file: "index.html", approximateLine: true, selector: "p.muted", snippet: '<p class="muted">low</p>' }, fix: { kind: "manual", summary: "Darken the text." }, key: "p.muted" }],
  },
  {
    meta: { id: "meta.robots", title: "title of meta.robots", severity: "error", needs: ["html"], docs: "https://example.test/meta.robots", standards: [] },
    run: (): FindingDraft[] => [{ message: "robots says no agents.\nSecond sentence, same line.", location: { file: "about.html", line: 2 }, fix: { kind: "manual", summary: "Allow agents in robots." }, key: "robots" }],
  },
];

const PAGES = `<!doctype html>
<html lang="en"><head><title>t</title></head>
<body><p>hi</p></body></html>
`;

/** The whole `--format llm` output for the fixture: the fix is first on every line, one line per finding. */
// The check count is 4 fixture checks plus the 2 suppression bookkeeping checks.
const EXPECTED = [
  "seaworthy llm dist: 4 findings in 2 files (2 errors, 1 warning, 1 note), 2 pages, 6 checks",
  "about.html",
  "  Allow agents in robots. | meta.robots error | about.html:2 | robots says no agents. Second sentence, same line.",
  "index.html",
  "  Point the link at /docs/guide.html. | links.internal error | index.html:4:10 | Link to /docs/guid.html points to a page that does not exist.",
  "  Add alt text. | images.alt warning | index.html:5 | <img> has no alt attribute.",
  "  Darken the text. | a11y.color-contrast note | index.html | Low contrast.",
]
  .join("\n") + "\n";

async function runLlm(cwd: string) {
  return run(["verify", "dist", "--format", "llm"], { cwd, checks });
}

test("--format llm emits the exact bytes of the fixture", async () => {
  const cwd = makeSite({ "dist/index.html": PAGES, "dist/about.html": PAGES });
  const { code, stdout, stderr } = await runLlm(cwd);
  assert.equal(stderr, "", "nothing is written to stderr, so stdout is the whole report");
  assert.equal(code, 1, "findings still change the exit code");
  assert.equal(stdout, EXPECTED);
});

test("llm output is deterministic run to run", async () => {
  const cwd = makeSite({ "dist/index.html": PAGES, "dist/about.html": PAGES });
  assert.equal((await runLlm(cwd)).stdout, (await runLlm(cwd)).stdout);
});

test("a clean site is one summary line", async () => {
  const cwd = makeSite({ "dist/index.html": PAGES });
  const quiet: Check = { meta: { id: "meta.quiet", title: "quiet", severity: "note", needs: ["html"], docs: "https://example.test/meta.quiet", standards: [] }, run: () => [] };
  const { stdout, stderr } = await run(["verify", "dist", "--format", "llm"], { cwd, checks: [quiet] });
  assert.equal(stderr, "");
  assert.equal(stdout, "seaworthy llm dist: 0 findings in 0 files, 1 page, 3 checks\n");
});

test("a check with no line reports the file alone", async () => {
  const report = buildReport({
    root: ".",
    pages: 1,
    checks: [checks[0]!],
    findings: [
      {
        checkId: "links.internal",
        severity: "error",
        message: "The sitemap points at a missing page.",
        location: { file: "sitemap.xml" },
        fix: { kind: "manual", summary: "Fix the sitemap.", edits: [], appliesTo: "built-output" },
        fingerprint: "f1",
      },
    ],
  });
  assert.equal(
    formatLlm(report),
    "seaworthy llm .: 1 finding in 1 file (1 error), 1 page, 1 check\nsitemap.xml\n  Fix the sitemap. | links.internal error | sitemap.xml | The sitemap points at a missing page.\n",
  );
});

test("crashed and skipped checks are one terse line each", () => {
  const report = buildReport({
    root: ".",
    pages: 1,
    checks: [checks[0]!],
    findings: [],
    skipped: [{ check: "a11y.color-contrast", reason: "needs a browser", hint: "Run --rendered." }],
    errors: [{ check: "x.crash", message: "boom\nbauble" }],
  });
  assert.equal(
    formatLlm(report),
    "seaworthy llm .: 0 findings in 0 files, 1 page, 1 check\ncrashed x.crash: boom bauble\nskipped a11y.color-contrast: needs a browser. Run --rendered.\n",
  );
});

test("scope, suppressions, baseline, and readability get one line each", () => {
  const report = buildReport({
    root: ".",
    pages: 3,
    checks: [checks[0]!],
    changedFiles: 3,
    baselined: 2,
    baselineStale: 1,
    suppressed: [{ checkId: "images.alt", fingerprint: "s1", file: "index.html", line: 5, reason: "by design", source: "inline" }],
    readability: { score: 50, checks: 2, passed: 1, withFindings: 1 },
    findings: [
      {
        checkId: "links.internal",
        severity: "error",
        message: "Broken.",
        location: { file: "index.html", line: 1, column: 1 },
        fix: { kind: "manual", summary: "Fix it.", edits: [], appliesTo: "built-output" },
        fingerprint: "f1",
      },
    ],
  });
  assert.equal(
    formatLlm(report),
    [
      "seaworthy llm .: 1 finding in 1 file (1 error), 3 pages, 1 check",
      "index.html",
      "  Fix it. | links.internal error | index.html:1:1 | Broken.",
      "scope: findings limited to the 3 files that changed",
      "suppressed: 1 finding hidden on purpose, not shown",
      "baselined: 2 findings accepted, not shown",
      "baseline-stale: 1 baseline entry no longer matches anything; run --update-baseline to prune",
      "readability: 50/100 (1 of 2 applicable checks clean)",
    ].join("\n") + "\n",
  );
});

test("a pipe or a newline from the site cannot reframe a line", () => {
  const report = buildReport({
    root: ".",
    pages: 1,
    checks: [checks[0]!],
    findings: [
      {
        checkId: "links.internal",
        severity: "warning",
        message: 'Link text is "| bad |\nstill bad |"',
        location: { file: "index.html", line: 2 },
        fix: { kind: "manual", summary: "Rewrite it.", edits: [], appliesTo: "built-output" },
        fingerprint: "f1",
      },
    ],
  });
  const [head, _group, line] = formatLlm(report).split("\n");
  assert.deepEqual(line?.split(" | "), ["  Rewrite it.", "links.internal warning", "index.html:2", 'Link text is "\\| bad \\| still bad \\|"'], "exactly four segments, with site pipes escaped");
  assert.equal(head, "seaworthy llm .: 1 finding in 1 file (1 warning), 1 page, 1 check");
});

test("--format llm is cheaper than --format json on the same findings", async () => {
  const cwd = makeSite({ "dist/index.html": PAGES, "dist/about.html": PAGES });
  const llm = (await runLlm(cwd)).stdout;
  const json = (await run(["verify", "dist", "--format", "json"], { cwd, checks })).stdout;
  assert.ok(llm.length < json.length / 2, `expected llm (${llm.length} bytes) to cost less than half of json (${json.length} bytes)`);
});

test("the other formats keep their own shape on the same fixture", async () => {
  const cwd = makeSite({ "dist/index.html": PAGES, "dist/about.html": PAGES });
  const json = JSON.parse((await run(["verify", "dist", "--format", "json"], { cwd, checks })).stdout);
  assert.deepEqual(reportErrors(json), []);
  assert.equal(json.findings.length, 4);
  const markdown = (await run(["verify", "dist", "--format", "markdown"], { cwd, checks })).stdout;
  assert.equal(markdown.split("\n")[0], "## Seaworthy: 4 findings in 2 files");
  const pretty = (await run(["verify", "dist"], { cwd, checks })).stdout;
  assert.match(pretty, /seaworthy 0\.0\.0: dist \(2 pages, 6 checks\)/);
});
