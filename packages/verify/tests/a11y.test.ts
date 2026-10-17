import assert from "node:assert/strict";
import { test } from "node:test";

import { a11yIframeTitle, a11yTabindex } from "../src/checks/a11y.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;

async function findings(body: string) {
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yTabindex] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("a11y.tabindex flags only whole numbers above zero", async () => {
  const lines = ['<a href="/" tabindex="1">a</a>', '<b tabindex="0">b</b>', '<b tabindex="-1">c</b>', '<b tabindex=" 7 ">d</b>', '<b tabindex="+2">e</b>', '<b tabindex="1.5">f</b>', '<b tabindex="">g</b>', "<b>h</b>"];
  assert.deepEqual((await findings(lines.join("\n"))).map((f) => f.location.line), [4, 7, 8]);
});

test("a11y.tabindex proposes tabindex=\"0\", keeping the quote style", async () => {
  const [double, single] = await findings(`<button tabindex="3">a</button>\n<button tabindex='4'>b</button>`);
  assert.deepEqual(double!.fix.edits.map((e) => [e.find, e.replace]), [['tabindex="3"', 'tabindex="0"']]);
  assert.deepEqual(single!.fix.edits.map((e) => [e.find, e.replace]), [["tabindex='4'", "tabindex='0'"]]);
  assert.equal(double!.severity, "warning");
});

test("a11y.iframe-title reports absent and blank titles without fetching embedded content", async () => {
  const body = [
    '<iframe src="https://example.invalid/map"></iframe>',
    '<iframe title=""></iframe>',
    '<iframe title=" &#32; "></iframe>',
    '<iframe title="Office location map"></iframe>',
    '<iframe title=" Video player "></iframe>',
    '<div title=""></div>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yIframeTitle] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 5, 6]);
  for (const finding of result.findings) {
    assert.equal(finding.checkId, "a11y.iframe-title");
    assert.equal(finding.severity, "error");
    assert.equal(finding.fix.kind, "manual");
    assert.deepEqual(finding.fix.edits, []);
    assert.match(finding.fix.summary, /title/);
  }
});
