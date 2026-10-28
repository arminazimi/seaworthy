import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlParseErrors } from "../src/checks/html.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

async function findings(files: Record<string, string | Buffer>) {
  const result = await runChecks({ site: buildSite(makeSite(files)), checks: [htmlParseErrors] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

const bodyFindings = (body: string) => findings({ "index.html": PAGE(body) });

test("html.parse-errors is a warning and needs only HTML", () => {
  assert.equal(htmlParseErrors.meta.id, "html.parse-errors");
  assert.equal(htmlParseErrors.meta.severity, "warning");
  assert.deepEqual(htmlParseErrors.meta.needs, ["html"]);
});

test("html.parse-errors reports duplicate attributes as errors at the parser's own position", async () => {
  const [single] = await bodyFindings('<div id="a" id="b">x</div>');
  assert.deepEqual([single!.location.line, single!.location.column], [5, 15]);
  assert.equal(single!.severity, "error");
  assert.match(single!.message, /duplicate-attribute/);
  assert.match(single!.fix.summary, /Fix the markup the parser rejected/);

  // The parser's own position for the duplicate attribute sits just after its name.
  const across = await bodyFindings('<p id\n="a"\nid="b">y</p>');
  assert.deepEqual(across.map((f) => [f.location.line, f.location.column]), [[7, 3]]);
});

test("html.parse-errors reports a stray end tag at its exact position", async () => {
  const found = await bodyFindings("<main>\n<p>hi</p>\n</main>\n</span>");
  assert.deepEqual(found.map((f) => [f.location.line, f.location.column]), [[8, 1]]);
  assert.match(found.find((f) => f.message.includes("</span>"))!.message, /closes nothing/);
  assert.equal(found.find((f) => f.message.includes("</span>"))!.severity, "warning");

  const [indented] = await bodyFindings("  </b>");
  assert.deepEqual([indented!.location.line, indented!.location.column], [5, 3]);
  assert.equal(indented!.fix.kind, "manual");
  assert.deepEqual(indented!.fix.edits, []);
  assert.match(indented!.fix.summary, /reopen the element/);
});

test("html.parse-errors reports a stray end tag on a CRLF file at the right line and column", async () => {
  const body = [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>t</title></head>',
    "<body>",
    '<div class="a">',
    "</div>",
    "</b>",
    "</body>",
    "</html>",
    "",
  ].join("\r\n");
  const found = await findings({ "crlf.html": body });
  assert.deepEqual(found.map((f) => [f.location.line, f.location.column]), [[7, 1]]);
});

test("html.parse-errors says </br> inserts a line break instead of closing anything", async () => {
  const [found] = await bodyFindings("</br>");
  assert.deepEqual([found!.location.line, found!.location.column], [5, 1]);
  assert.match(found!.message, /<\/br> closes nothing/);
  assert.match(found!.fix.summary, /<br>/);
});

test("html.parse-errors keeps one identity per occurrence of the same stray end tag", async () => {
  // Two stray end tags of one kind: distinct identities per occurrence, without line numbers.
  const found = await bodyFindings("</a>\n</a>\n<p>x</p>");
  assert.equal(found.length, 2);
  assert.notEqual(found[0]!.fingerprint, found[1]!.fingerprint);
});

test("html.parse-errors reports an unclosed element that swallows content until a parent's end tag", async () => {
  // The section's end tag closes the span the author left open: browsers keep the rest of the section inside the span.
  const [span] = await bodyFindings("<section><div><span>x</div>\n<p>after</p>\n</section>");
  assert.deepEqual([span!.location.line, span!.location.column], [5, 15]);
  assert.match(span!.message, /<span> has no end tag/);
  assert.match(span!.fix.summary, /<\/span>/);
});

test("html.parse-errors reports an element left open at the end of the file", async () => {
  const [div] = await bodyFindings("<div><p>a</p>");
  assert.deepEqual([div!.location.line, div!.location.column], [5, 1]);
  assert.match(div!.message, /<div> has no end tag/);
});

test("html.parse-errors is silent on optional end tags, void elements, and restructured formatting elements", async () => {
  assert.deepEqual(await bodyFindings([
    "<ul><li>one<li>two</ul>",
    "<ol><li>three</ol>",
    "<dl><dt>tip<dd>text</dl>",
    "<table><tr><td>a</td><td>b</td></tr></table>",
    "<select><option>a<option>b</select>",
    "<p>ok",
    "<div><br><hr><img src=\"/x.png\" alt=\"x\"><input type=\"text\"><hr></div>",
    // The text between the misnested tags keeps the second formatting element alive, so its end tag closes it.
    "<span><b><i>bold italic</b> plain</i></span>",
    '<div><frame src="/a.html"></div>',
    "<svg><g><circle cx=\"8\" cy=\"8\" r=\"8\"></circle></g></svg>",
  ].join("\n")), []);
});

test("html.parse-errors never reports tag-shaped text inside a script, style, comment, or attribute", async () => {
  assert.deepEqual(await bodyFindings([
    "<script>var a = '</div>'; function f() { if (x < y) {} }</script>",
    "<style>.a > .b::after { content: '</div>'; }</style>",
    "<!-- </div> </b> -->",
    '<a title="</div>">link text</a>',
    "<textarea></div></b></textarea>",
    "<p>RCDATA <em>text</em></p>",
  ].join("\n")), []);
});

test("html.parse-errors reports other tokenizer errors with the parser's position and severity", async () => {
  // A non-void element with nothing after it: the solidus is ignored and the element still has no end tag.
  const [solidus, open] = await bodyFindings("<div />x");
  assert.deepEqual([solidus!.location.line, solidus!.location.column], [5, 1]);
  assert.match(solidus!.message, /non-void-html-element-start-tag-with-trailing-solidus/);
  assert.equal(solidus!.severity, "warning");
  assert.match(open!.message, /<div> has no end tag/);

  // A tag that runs into the never-closed `<p<div`: parse5 stops at the end of the file and reports what it saw.
  const inTag = (await bodyFindings("<p<div")).filter((f) => f.message.startsWith("The HTML parser reported"));
  assert.deepEqual(inTag.map((f) => [f.message.match(/reported ([a-z-]+)/)![1], f.location.line, f.location.column]), [
    ["unexpected-character-in-attribute-name", 6, 1],
    ["unexpected-solidus-in-tag", 6, 3],
  ]);
});

test("html.parse-errors keeps one identity per occurrence of the same error kind", async () => {
  const found = await bodyFindings('<label id="a" id="b" id="c">l</label>');
  assert.equal(found.length, 2);
  assert.notEqual(found[0]!.fingerprint, found[1]!.fingerprint);
  const again = await bodyFindings('<label id="a" id="b" id="c">l</label>');
  assert.deepEqual(found, again);
});

test("html.parse-errors is silent on clean markup", async () => {
  assert.deepEqual(await bodyFindings([
    "<div class=\"center\"><p>Centered with CSS.</p></div>",
    "<img src=\"/x.png\" alt=\"x\" width=\"64\" height=\"64\">",
    '<table class=\"totals\"><caption>Totals</caption><tr><td>1</td></tr></table>',
    '<iframe src="/embed.html" title="Embedded"></iframe>',
    "<script type=\"module\" src=\"/app.js\"></script>",
    "<ruby>漢<rt>kan</rt></ruby>",
    "<main><h1>One</h1><p>Two</p></main>",
  ].join("\n")), []);
  // And on a page with no markup problems at all, on several files in one run.
  assert.deepEqual(await findings({
    "a.html": PAGE("<p>one</p>"),
    "b.html": PAGE("<p>two</p>"),
  }), []);
});
