import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli.js";
import { imagesAlt } from "../src/checks/images.js";
import { linksInternal } from "../src/checks/links.js";
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
