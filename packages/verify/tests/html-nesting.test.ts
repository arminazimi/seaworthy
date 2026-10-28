import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlNesting } from "../src/checks/html.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

async function findings(files: Record<string, string>) {
  const result = await runChecks({ site: buildSite(makeSite(files)), checks: [htmlNesting] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

const bodyFindings = (body: string) => findings({ "index.html": PAGE(body) });

/** Where each finding points: [line, column] pairs, in report order. */
const at = (found: Awaited<ReturnType<typeof bodyFindings>>) => found.map((f) => [f.location.line, f.location.column]);

test("html.nesting is a warning and needs only HTML", () => {
  assert.equal(htmlNesting.meta.id, "html.nesting");
  assert.equal(htmlNesting.meta.severity, "warning");
  assert.deepEqual(htmlNesting.meta.needs, ["html"]);
  assert.deepEqual(htmlNesting.meta.standards, ["HTML Standard"]);
});

test("html.nesting reports a block element written inside <p>", async () => {
  const found = await bodyFindings('<p>Intro\n<div>Block</div>\ntail</p>');
  assert.deepEqual(at(found), [[6, 1]]);
  assert.match(found[0]!.message, /<div> is written inside <p>/);
  assert.match(found[0]!.message, /parser ends the paragraph/);
  assert.match(found[0]!.fix.summary, /Close the paragraph/);
  assert.equal(found[0]!.fix.kind, "manual");
  assert.deepEqual(found[0]!.fix.edits, []);
  assert.equal(found[0]!.severity, "warning");
});

test("html.nesting reports the elements that end a paragraph, once each", async () => {
  const found = await bodyFindings('<p>a<table><tr><td>b</td></tr></table></p>\n<p>c<li>d\n<p>e<hr><p>f<pre>g</pre>\n<p>h<address>');
  assert.deepEqual(at(found), [[5, 5], [6, 5], [7, 5], [7, 13], [8, 5]]);
});

test("html.nesting reports a nested paragraph at its start tag", async () => {
  const found = await bodyFindings('<p>a<p>b</p>\n<p>c<p>d');
  assert.deepEqual(at(found), [[5, 5], [6, 5]]);
});

test("html.nesting keeps waiting for the block through phrasing content", async () => {
  const found = await bodyFindings('<p>a<em>b</em>\n <section>c</section>');
  assert.deepEqual(at(found), [[6, 2]]);
});

test("html.nesting accepts <p> closed before the block and phrasing content inside <p>", async () => {
  assert.deepEqual(await bodyFindings('<p>a</p>\n<div>b</div>\n<p>c<em>d</em><span>e</span><img src="/x.png" alt="x"></p>'), []);
});

test("html.nesting accepts a trailing unclosed <p> with no block after it", async () => {
  assert.deepEqual(await bodyFindings('<p>trailing text'), []);
});

test("html.nesting ignores the paragraph the parser creates for a stray end tag", async () => {
  // </p> with no open <p> inserts an element that has no source position; the check must not flag it.
  assert.deepEqual(await bodyFindings('<div>b</div></p>'), []);
});

test("html.nesting reports nested links, including inside a wrapped block and in a chain", async () => {
  const plain = await bodyFindings('<a href="/a">x<a href="/b">y</a>z</a>');
  assert.deepEqual(at(plain), [[5, 15]]);
  assert.match(plain[0]!.message, /<a> starts before the enclosing <a>/);

  // The wrapped <div> splits the <p> and the second <a> splits the first, so the page is reported twice.
  const wrapped = await bodyFindings('<p><a href="/a">x <div><a href="/b">y</a></div></a></p>');
  assert.deepEqual(at(wrapped), [[5, 19], [5, 24]]);

  const triple = await bodyFindings('<a href="/a">x<a href="/b">y<a href="/c">z</a></a></a>');
  assert.deepEqual(at(triple), [[5, 15], [5, 29]]);
});

test("html.nesting accepts links that close before the next one and SVG links", async () => {
  assert.deepEqual(await bodyFindings('<a href="/a">x</a>\n<span>\n<a href="/b">y</a>\n</span>\n<svg><a href="/c"><text>z</text></a></svg>'), []);
});

test("html.nesting reports nested buttons at the inner start tag", async () => {
  const found = await bodyFindings('<button>A<button>B</button></button>');
  assert.deepEqual(at(found), [[5, 10]]);
  assert.match(found[0]!.message, /<button> starts before the enclosing <button>/);
});

test("html.nesting reports interactive content inside links and buttons", async () => {
  const found = await bodyFindings([
    '<a href="/a">x<button>B</button></a>',
    '<a href="/a"><select size="1"><option>o</select></a>',
    '<a href="/a"><iframe src="/e.html" title="e"></iframe></a>',
    '<button><textarea></textarea></button>',
  ].join("\n"));
  assert.deepEqual(at(found), [[5, 15], [6, 14], [7, 14], [8, 9]]);
});

test("html.nesting reports interactive content inside a <label> that is not its control", async () => {
  const found = await bodyFindings('<label for="i">N <a href="/x">help</a></label>\n<input id="i">');
  assert.deepEqual(at(found), [[5, 18]]);
  assert.match(found[0]!.fix.summary, /<label>/);
});

test("html.nesting reports a nested <label> on the inner one", async () => {
  const found = await bodyFindings('<label>a<label>b</label></label>');
  assert.deepEqual(at(found), [[5, 9]]);
});

test("html.nesting accepts the control a <label> labels and hidden inputs", async () => {
  assert.deepEqual(await bodyFindings('<label>Name <input id="n"></label>'), []);
  assert.deepEqual(await bodyFindings('<label for="n">Name</label><textarea id="n"></textarea>'), []);
  assert.deepEqual(await bodyFindings('<label>Phone <select size="1"><option>+1</select></label>'), []);
  assert.deepEqual(await bodyFindings('<a href="/a"><input type="hidden"></a>'), []);
  assert.deepEqual(await bodyFindings('<label for="n">Name</label><input type="hidden" id="n">'), []);
});

test("html.nesting ignores elements outside the rule's content model", async () => {
  assert.deepEqual(await bodyFindings('<svg><a href="/x"><text>t</text></a></svg>'), []);
  // <details> allows flow content, and an <a> without href placed as an anchor is not interactive either.
  assert.deepEqual(await bodyFindings('<details><summary>s</summary><a href="/x">l</a></details>'), []);
  assert.deepEqual(await bodyFindings('<a id="anchor">plain text</a><button><em>t</em></button>'), []);
});
