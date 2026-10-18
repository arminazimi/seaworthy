import assert from "node:assert/strict";
import { test } from "node:test";

import { a11yEmptyHeadings, a11yTabindex } from "../src/checks/a11y.js";
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

test("a11y.empty-headings flags headings with no text, name, or labelled content", async () => {
  const body = [
    "<h2></h2>",
    "<h3>   </h3>",
    '<h2><span class="icon"></span></h2>',
    '<div role="heading" aria-level="2"></div>',
    "<h2>Text</h2>",
    '<h2><img src="/a.png" alt="Logo"></h2>',
    '<h2><img src="/a.png" alt=""></h2>',
    '<h2 aria-label="Named"></h2>',
    '<h2 aria-labelledby="x"></h2>',
    "<h2 hidden></h2>",
    '<div aria-hidden="true"><h2></h2></div>',
    "<h2><!-- note --></h2>",
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yEmptyHeadings] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 5, 6, 7, 15]);
  assert.ok(result.findings.every((f) => f.severity === "warning" && f.fix.kind === "manual" && f.fix.edits.length === 0));
});
