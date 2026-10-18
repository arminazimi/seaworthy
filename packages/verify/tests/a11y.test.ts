import assert from "node:assert/strict";
import { test } from "node:test";

import { a11yAriaReferences, a11yDuplicateId, a11yEmptyHeadings, a11yHiddenFocusable, a11yTabindex } from "../src/checks/a11y.js";
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
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 5, 6, 7, 10, 15]);
  assert.ok(result.findings.every((f) => f.severity === "warning" && f.fix.kind === "manual" && f.fix.edits.length === 0));
});

test("a11y.duplicate-id reports every repeat after the first, per page", async () => {
  const page = (body: string) => PAGE(body);
  const site = makeSite({
    "index.html": page('<p id="a">1</p>\n<p id="b">2</p>\n<p id="a">3</p>\n<p id="a">4</p>\n<p id="">5</p>\n<p id="">6</p>\n<svg id="b"></svg>'),
    "other.html": page('<p id="a">other page</p>'),
  });
  const result = await runChecks({ site: buildSite(site), checks: [a11yDuplicateId] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => [f.location.file, f.location.line, f.location.column]), [["index.html", 6, 4], ["index.html", 7, 4], ["index.html", 10, 6]]);
  assert.match(result.findings[0]!.message, /id="a" is already used .* on line 4/);
  const keys = result.findings.map((f) => f.fingerprint);
  assert.equal(new Set(keys).size, 3, "each repeat has its own fingerprint");
});

test("a11y.aria-references reports ids that are not on the page and keeps the ones that are", async () => {
  const body = [
    '<h2 id="t">Title</h2>',
    '<div aria-labelledby="t">ok</div>',
    '<div aria-labelledby="t missing">partly</div>',
    '<div aria-describedby="nope">no</div>',
    '<button aria-controls="panel other">x</button>',
    '<div aria-labelledby="">empty</div>',
    '<div aria-labelledby="  t  ">spaces</div>',
    '<a name="legacy"></a><div aria-details="legacy">named anchor</div>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yAriaReferences] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => [f.location.line, f.location.column]), [[6, 6], [7, 6], [8, 9]]);
  assert.match(result.findings[0]!.message, /: missing\./);
  assert.match(result.findings[2]!.message, /panel, other/);
  assert.ok(result.findings.every((f) => f.severity === "error" && f.fix.kind === "manual"));
});

test("a11y.hidden-focusable reports aria-hidden content a keyboard can still reach", async () => {
  const body = [
    '<div aria-hidden="true"><a href="/x">link</a></div>',
    '<button aria-hidden="true">self</button>',
    '<div aria-hidden="true"><a href="/x">a</a><button>b</button></div>',
    '<div aria-hidden="true"><a href="/x" tabindex="-1">out of the tab order</a></div>',
    '<div aria-hidden="true"><button disabled>off</button><a>no href</a><span>text</span></div>',
    '<div aria-hidden="true"><div aria-hidden="true"><input></div></div>',
    '<div aria-hidden="true"><div hidden><a href="/x">hidden</a></div></div>',
    '<span aria-hidden="true" tabindex="0">icon</span>',
    '<div aria-hidden="false"><a href="/x">visible</a></div>',
    '<div aria-hidden="true"><input type="hidden"></div>',
  ].join("\n");
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(body) })), checks: [a11yHiddenFocusable] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings.map((f) => f.location.line), [4, 5, 6, 9, 11]);
  assert.match(result.findings[2]!.message, /hides 2 focusable elements/);
  assert.ok(result.findings.every((f) => f.severity === "error" && f.fix.kind === "manual"));
});
