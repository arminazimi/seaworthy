import assert from "node:assert/strict";
import { test } from "node:test";

import { diffReports } from "../src/diff.js";
import { MAX_MARKDOWN_ROWS, formatDiffComment } from "../src/formats/markdown.js";
import { buildReport } from "../src/report.js";
import type { Finding, Report } from "../src/types.js";

// A synthetic case, built by hand: one problem carried over (unchanged), one introduced
// (new), one resolved (fixed). The comment mentions the new and fixed ones, never the
// unchanged one.
const missingAlt: Finding = {
  checkId: "images.alt",
  severity: "warning",
  message: '<img src="/a.png"> has no alt attribute.',
  location: { file: "docs/link.html", line: 5 },
  fix: { kind: "edit", summary: "Add alt text.", edits: [], appliesTo: "built-output" },
  fingerprint: "bbbbbbbb22222222",
};
const brokenLink: Finding = {
  checkId: "links.internal",
  severity: "error",
  message: "Link to /docs/guid.html points to a page that does not exist.",
  location: { file: "docs/link.html", line: 4, column: 10 },
  fix: { kind: "edit", summary: "Point the link at /docs/guide.html.", edits: [], appliesTo: "built-output" },
  fingerprint: "aaaaaaaa11111111",
};
const noCharset: Finding = {
  checkId: "html.charset",
  severity: "error",
  message: "No character encoding is declared.",
  location: { file: "a.html", line: 1 },
  fix: { kind: "edit", summary: "Declare a charset in the head.", edits: [], appliesTo: "built-output" },
  fingerprint: "dddddddd44444444",
};

const report = (root: string, findings: readonly Finding[]): Report => buildReport({ root, pages: 2, checks: [], findings });

const diff = (): ReturnType<typeof diffReports> =>
  diffReports(
    { root: "dist", findings: [missingAlt, noCharset] },
    { root: "dist", findings: [brokenLink, missingAlt] },
  );

test("the PR comment is exact, deterministic markdown for a small diff", () => {
  const body = formatDiffComment(diff());
  assert.equal(
    body,
    `## Seaworthy: 1 new, 1 fixed

\`dist\`: 2 findings before, 2 findings after, 1 unchanged.

**New**

| Severity | Check | Location | Problem |
| --- | --- | --- | --- |
| error | \`links.internal\` | \`docs/link.html:4:10\` | Link to /docs/guid.html points to a page that does not exist. |

**Fixed**

| Severity | Check | Location | Problem |
| --- | --- | --- | --- |
| error | \`html.charset\` | \`a.html:1\` | No character encoding is declared. |

<!-- seaworthy:pr-comment -->\n`,
  );
  assert.equal(formatDiffComment(diff()), body, "the same diff builds the same bytes");
  assert.ok(body.endsWith("<!-- seaworthy:pr-comment -->\n"), "the Action marker ends the comment");
});

test("an unchanged run says so in one line and lists nothing", () => {
  const report = { root: "dist", findings: [brokenLink, missingAlt] };
  const body = formatDiffComment(diffReports(report, report));
  assert.equal(
    body,
    `## Seaworthy: no findings changed

\`dist\`: 2 findings before, 2 findings after, 2 unchanged.

<!-- seaworthy:pr-comment -->\n`,
  );
});

test("only fixed and only new diffs read the same way, without empty sections", () => {
  const clean = { root: "dist", findings: [] as Finding[] };
  const everything = diffReports(clean, { root: "dist", findings: [brokenLink, missingAlt, noCharset] });
  const onlyNew = formatDiffComment(everything);
  assert.match(onlyNew, /^## Seaworthy: 3 new, 0 fixed\n/);
  assert.ok(onlyNew.includes("**New**"));
  assert.ok(!onlyNew.includes("**Fixed**"), "no empty fixed section");
  const cleanNow = formatDiffComment(diffReports({ root: "dist", findings: [brokenLink, missingAlt, noCharset] }, clean));
  assert.match(cleanNow, /^## Seaworthy: 0 new, 3 fixed\n/);
  assert.ok(cleanNow.includes("**Fixed**"));
  assert.ok(!cleanNow.includes("**New**"), "no empty new section");
});

test("problem text is escaped for a table cell and check IDs are code spans", () => {
  const hostile: Finding = {
    checkId: "x.note",
    severity: "note",
    message: "Say | this, `that`, more|\nand a second line.",
    location: { file: "a.html", line: 2 },
    fix: { kind: "manual", summary: "Any text goes in.", edits: [], appliesTo: "built-output" },
    fingerprint: "eeeeeeee55555555",
  };
  const body = formatDiffComment(diffReports({ root: "dist", findings: [] }, { root: "dist", findings: [hostile] }));
  assert.ok(body.includes("| Say \\| this, `that`, more\\| and a second line. |"), "pipes become \\| and line breaks become spaces");
});

test("a diff with more findings than the cap is capped with a pointer to the report", () => {
  const many = (n: number): Report => report("dist", Array.from({ length: n }, (_, i): Finding => ({ ...brokenLink, fingerprint: `f${i}` })));
  const body = formatDiffComment(diffReports({ root: "dist", findings: [] }, many(MAX_MARKDOWN_ROWS + 3)));
  const rows = body.split("\n").filter((line) => line.startsWith("| error"));
  assert.equal(rows.length, MAX_MARKDOWN_ROWS, "only MAX_MARKDOWN_ROWS rows are shown");
  assert.ok(body.includes("...and 3 more. Run `seaworthy verify --format json` for the full report."));
});
