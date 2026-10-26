import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlObsolete } from "../src/checks/html.js";
import { OBSOLETE_ELEMENTS } from "../src/checks/html-data.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

async function findings(files: Record<string, string>) {
  const result = await runChecks({ site: buildSite(makeSite(files)), checks: [htmlObsolete] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

const bodyFindings = (body: string) => findings({ "index.html": PAGE(body) });

test("html.obsolete is a note and needs only HTML", () => {
  assert.equal(htmlObsolete.meta.id, "html.obsolete");
  assert.equal(htmlObsolete.meta.severity, "note");
  assert.deepEqual(htmlObsolete.meta.needs, ["html"]);
});

test("html.obsolete reports every obsolete element exactly once", async () => {
  // Frames need a frameset document; every other element parses in a normal body.
  for (const tag of OBSOLETE_ELEMENTS.keys()) {
    if (tag === "frame" || tag === "frameset") continue;
    const found = await bodyFindings(`<${tag}></${tag}>`);
    assert.equal(found.length, 1, `${tag} should produce one finding`);
    assert.match(found[0]!.message, new RegExp(`<${tag}>`), tag);
  }
});

test("html.obsolete reports frame and frameset in a frameset document", async () => {
  const frameset = '<!doctype html>\n<html lang="en">\n<head><title>t</title></head>\n<frameset cols="50%,50%">\n<frame src="/a.html">\n<frameset><frame src="/b.html"></frameset>\n</frameset>\n</html>\n';
  const found = (await findings({ "index.html": frameset })).map((f) => [f.message.slice(0, 20), f.location.line, f.location.column]);
  assert.deepEqual(found, [
    ["<frameset> is obsole", 4, 1],
    ["<frame> is obsolete.", 5, 1],
    ["<frameset> is obsole", 6, 1],
    ["<frame> is obsolete.", 6, 11],
  ]);
});

test("html.obsolete locates an element at its start tag and the attribute inside it", async () => {
  const [center, font] = await bodyFindings('<div>\n  <center>Sale</center>\n  <font size="5" color="red">Big</font>\n</div>');
  assert.deepEqual([center!.location.line, center!.location.column], [6, 3]);
  assert.deepEqual([font!.location.line, font!.location.column], [7, 3]);
  assert.equal(center!.severity, "note");
  assert.equal(center!.fix.kind, "manual");
  assert.deepEqual(center!.fix.edits, []);
  assert.match(center!.fix.summary, /CSS/);
  assert.match(font!.fix.summary, /font-family/);
});

test("html.obsolete reports obsolete attributes at the attribute, not the element", async () => {
  const body = [
    '<div align="center">a</div>',
    '<table bgcolor="#eee"><tr><td valign="top">b</td></tr></table>',
    '<img src="/x.png" alt="x" border="0">',
    '<img src="/x.png" alt="y" width="10" height="10">',
    '<ol type="a"><li type="i">c</li></ol>',
    '<select size="3"></select>',
    '<hr color="red" size="3" noshade>',
  ].join("\n");
  const found = await bodyFindings(body);
  assert.deepEqual(
    found.map((f) => [f.message.split(" ")[1], f.location.line, f.location.column]),
    [
      ["align", 5, 6],
      ["bgcolor", 6, 8],
      ["valign", 6, 31],
      ["border", 7, 27],
      ["type", 9, 18],
      ["color", 11, 5],
      ["size", 11, 17],
      ["noshade", 11, 26],
    ],
  );
  for (const finding of found) {
    assert.equal(finding.fix.kind, "manual");
    assert.deepEqual(finding.fix.edits, []);
    assert.match(finding.fix.summary, /CSS|Use/);
  }
});

test("html.obsolete reports an attribute on its own line when the start tag spans lines", async () => {
  const [finding] = await bodyFindings('<img\n  src="/x.png"\n  alt="x"\n  border="0">');
  assert.deepEqual([finding!.location.line, finding!.location.column], [8, 3]);
});

test("html.obsolete treats element and attribute names case-insensitively", async () => {
  const found = await bodyFindings('<CENTER>x</CENTER>\n<P ALIGN="center">y</P>');
  assert.deepEqual(found.map((f) => f.location.line), [5, 6]);
  assert.match(found[0]!.message, /<center>/);
  assert.match(found[1]!.message, /align.*<p>/);
});

test("html.obsolete does not report attributes on an obsolete element twice", async () => {
  const [finding] = await bodyFindings('<font size="5" color="red" face="Arial">Big</font>');
  assert.equal(finding!.message.startsWith("<font> is obsolete."), true);
  assert.equal(finding!.location.column, 1);
});

test("html.obsolete ignores SVG elements that share a name with an obsolete HTML element", async () => {
  // SVG has its own <font> element, in the SVG namespace, which is not an HTML obsolete-features finding.
  const found = await bodyFindings("<svg><font></font></svg>");
  assert.deepEqual(found, []);
});

test("html.obsolete stays silent on modern markup and valid presentational-free HTML", async () => {
  const body = [
    '<div class="center"><p>Centered with CSS.</p></div>',
    '<img src="/logo.png" alt="Logo" width="64" height="64">',
    '<ol type="a"><li>First</li></ol>',
    '<select size="3"><option>One</option></select>',
    '<table class="totals"><caption>Totals</caption><tr><td>1</td></tr></table>',
    '<iframe src="/embed.html" title="Embedded"></iframe>',
    '<script type="module" src="/app.js"></script>',
    '<ruby>漢<rt>kan</rt></ruby>',
    '<div data-align="center">Not an attribute.</div>',
  ].join("\n");
  assert.deepEqual(await bodyFindings(body), []);
});
