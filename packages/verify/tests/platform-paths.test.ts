import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli.js";
import { imagesAlt } from "../src/checks/images.js";
import { linksInternal } from "../src/checks/links.js";
import { buildReport } from "../src/report.js";
import { makeSite, reportErrors, sarifErrors } from "./helpers.js";

const PAGE = [
  '<!doctype html><html lang="en"><head><title>Guide</title></head>',
  '<body><a href="guide.htm">Guide</a>',
  '<!-- seaworthy-ignore images.alt: decorative image -->',
  '<img src="logo.png">',
  '</body></html>',
];
const checks = [imagesAlt, linksInternal];

function site(newline: string): string {
  return makeSite({
    "build/site output/docs/über page.html": PAGE.join(newline),
    "build/site output/docs/guide.html": '<!doctype html><title>Target</title>',
  });
}

test("nested native paths produce identical JSON for LF and CRLF pages", async () => {
  const outputs = [];
  for (const newline of ["\n", "\r\n"]) {
    const result = await run(["verify", "build/site output", "--format", "json"], { cwd: site(newline), checks });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.deepEqual(reportErrors(report), []);
    assert.equal(report.root, "build/site output");
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].location.file, "docs/über page.html");
    assert.equal(report.findings[0].location.line, 2);
    assert.equal(report.summary.suppressed, 1, "CRLF must not shift the inline suppression to a different line");
    assert.ok(!result.stdout.includes("\\\\"), "native Windows separators must not leak into report paths");
    outputs.push(result.stdout);
  }
  assert.equal(outputs[0], outputs[1]);
});

test("SARIF fixes retain exact columns and forward-slash paths with CRLF", async () => {
  const result = await run(["verify", "build/site output", "--format", "sarif"], { cwd: site("\r\n"), checks });
  const sarif = JSON.parse(result.stdout);
  assert.deepEqual(sarifErrors(sarif), []);
  const finding = sarif.runs[0].results[0];
  assert.equal(finding.locations[0].physicalLocation.artifactLocation.uri, "build/site%20output/docs/%C3%BCber%20page.html");
  const change = finding.fixes[0].artifactChanges[0];
  assert.equal(change.artifactLocation.uri, "build/site%20output/docs/%C3%BCber%20page.html");
  const replacement = change.replacements[0];
  const region = replacement.deletedRegion;
  assert.equal(region.startLine, 2);
  assert.equal(PAGE[region.startLine - 1]!.slice(region.startColumn - 1, region.endColumn - 1), 'href="guide.htm"');
  assert.equal(replacement.insertedContent.text, 'href="guide.html"');
});

test("config globs and suppressions written with Windows separators still apply", async () => {
  const DRAFT = '<!doctype html><html lang="en"><head><title>Draft</title></head><body><img src="logo.png"><a href="missing.htm">x</a></body></html>';
  const KEPT = '<!doctype html><html lang="en"><head><title>Kept</title></head><body><img src="logo.png"></body></html>';
  const root = makeSite({
    "build/site output/docs/nested/draft page.html": DRAFT,
    "build/site output/docs/nested/kept page.html": KEPT,
    "seaworthy.config.json": JSON.stringify({
      ignore: ["docs\\nested\\kept page.html"],
      suppressions: [{ check: "images.alt", file: "docs/nested\\draft page.html", reason: "decorative sprite, tracked elsewhere" }],
    }),
  });
  const result = await run(["verify", "build/site output", "--format", "json"], { cwd: root, checks });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.deepEqual(reportErrors(report), []);
  // The ignored file's findings are gone, the suppression dropped the image finding, and
  // only the broken link on the draft page survives.
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].checkId, "links.internal");
  assert.equal(report.findings[0].location.file, "docs/nested/draft page.html");
  assert.equal(report.summary.suppressed, 1);
  assert.ok(!result.stdout.includes("\\\\"), "Windows separators in config must not leak into report paths");
});

test("findings on later lines keep their line and column with CRLF line endings", async () => {
  const LINES = [
    '<!doctype html><html lang="en"><head><title>Lines</title></head>',
    "<body>",
    "",
    '  <a href="missing-target.htm">broken on purpose</a>',
    "",
    '  <img src="untouched.png">',
    "</body></html>",
  ];
  const jsonOutputs: string[] = [];
  const prettyOutputs: string[] = [];
  for (const newline of ["\n", "\r\n"]) {
    const root = makeSite({
      "build/site output/docs/lines.html": LINES.join(newline),
      "build/site output/docs/target.html": '<!doctype html><title>Target</title>',
    });
    const json = await run(["verify", "build/site output", "--format", "json"], { cwd: root, checks });
    assert.equal(json.code, 1);
    assert.equal(json.stderr, "");
    const report = JSON.parse(json.stdout);
    assert.deepEqual(reportErrors(report), []);
    const link = report.findings.find((f: { checkId: string }) => f.checkId === "links.internal");
    const image = report.findings.find((f: { checkId: string }) => f.checkId === "images.alt");
    assert.equal(link.location.line, 4, "CRLF must not shift a finding off its line");
    assert.equal(link.location.column, 6, 'the first character of href="…"');
    assert.equal(image.location.line, 6);
    assert.equal(image.location.column, 3, "the start of the <img> element");
    const pretty = await run(["verify", "build/site output", "--format", "pretty"], { cwd: root, checks });
    assert.equal(pretty.code, 1);
    assert.equal(pretty.stderr, "");
    jsonOutputs.push(json.stdout);
    prettyOutputs.push(pretty.stdout);
  }
  // Both formats must be byte-identical whether the source used LF or CRLF.
  assert.equal(jsonOutputs[1], jsonOutputs[0]);
  assert.equal(prettyOutputs[1], prettyOutputs[0]);
});

test("deeply nested folders and very long file names report stable relative paths", async () => {
  const segments = Array.from({ length: 30 }, (_, i) => `deep-directory-${i}`);
  const name = `${"very-long-file-name-".repeat(10)}.html`; // 210 characters, under any filesystem's NAME_MAX
  const rel = [...segments, name].join("/");
  const root = makeSite({
    [`build/site output/${rel}`]: '<!doctype html><html lang="en"><head><title>Deep</title></head><body><a href="missing-target.htm">x</a></body></html>',
    "build/site output/index.html": '<!doctype html><title>Home</title>',
  });
  const first = await run(["verify", "build/site output", "--format", "json"], { cwd: root, checks });
  assert.equal(first.code, 1);
  assert.equal(first.stderr, "");
  const report = JSON.parse(first.stdout);
  assert.deepEqual(reportErrors(report), []);
  assert.equal(report.root, "build/site output");
  const finding = report.findings[0];
  assert.equal(finding.location.file, rel);
  assert.equal(finding.location.line, 1);
  assert.ok(!first.stdout.includes("\\\\"), "deep paths must stay forward-slash relative");

  // A second run over a fresh copy of the same site is byte-identical: no absolute or
  // machine-specific paths escape into the report.
  const again = await run(["verify", "build/site output", "--format", "json"], { cwd: root, checks });
  assert.equal(again.stdout, first.stdout);
});

test("the report refuses absolute site roots, whatever separator style", () => {
  for (const bad of ["/tmp/site", "\\site", "C:\\site", "D:/site"]) {
    assert.throws(() => buildReport({ root: bad, pages: 0, checks: [], findings: [] }), /must be relative/);
  }
  assert.doesNotThrow(() => buildReport({ root: ".", pages: 0, checks: [], findings: [] }));
  assert.doesNotThrow(() => buildReport({ root: "build/site output", pages: 0, checks: [], findings: [] }));
});
