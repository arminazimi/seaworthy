import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlInlineHandlers } from "../src/checks/html.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = (body = "") => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;

async function run(check: Check, body: string): Promise<Finding[]> {
  const site = buildSite(makeSite({ "index.html": PAGE(body) }));
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

const where = (found: Finding[]) => found.map((f) => [f.location.line, f.location.column]);
const subj = (found: Finding[]) => found.map((f) => f.message.match(/The (\S+) attribute on <(\S+)>/)?.slice(1));

test("html.inline-handlers: reports each handler with its exact location", async () => {
  const found = await run(htmlInlineHandlers, '<button type="button" onclick="addToCart()">Add</button>\n<div onmouseover="show()">Hover</div>\n<p>Plain text</p>\n<a href="/next.html" onfocusin="track()">Next</a>');
  assert.deepEqual(where(found), [[4, 23], [5, 6], [7, 22]]);
  assert.deepEqual(subj(found), [["onclick", "button"], ["onmouseover", "div"], ["onfocusin", "a"]]);
  assert.equal(found[0]!.severity, "note");
  assert.equal(found.every((f) => f.fix.kind === "manual" && f.fix.edits.length === 0), true, "the fix is manual: the code moves to an external script");
});

test("html.inline-handlers: an attribute whose handler is an upper-case mix is still reported", async () => {
  assert.deepEqual(where(await run(htmlInlineHandlers, '<div onCLICK="go()">Go</div>')), [[4, 6]]);
});

test("html.inline-handlers: a handler with no code still blocks a strict CSP", async () => {
  const found = await run(htmlInlineHandlers, '<div oncopy="">Copy</div>');
  assert.deepEqual(subj(found), [["oncopy", "div"]]);
});

test("html.inline-handlers: attributes that merely start elsewhere are not handlers", async () => {
  assert.deepEqual(await run(htmlInlineHandlers, '<div data-on="no" bond="no" on>n o</div>'), []);
});

test("html.inline-handlers: repeats are finding by finding, unique and stable", async () => {
  const found = await run(htmlInlineHandlers, '<div onclick="a()">One</div><div onclick="a()">Same</div><div onclick="a()">Again</div>');
  assert.equal(found.length, 3);
  assert.equal(new Set(found.map((f) => f.fingerprint)).size, 3, "each handler has its own fingerprint");
});

test("html.inline-handlers: javascript: URLs in the attributes that follow them", async () => {
  const found = await run(htmlInlineHandlers, [
    '<a href="javascript:toggle()">Toggle</a>',
    '<a href="  JavaScript:void(0)">Upper and padded</a>',
    '<form action="javascript:submit()">Form</form>',
    '<iframe src="javascript:f()"></iframe>',
    '<input type="submit" formaction="JavaScript:go()">',
    '<button type="button" formaction="javascript:go()" onclick="go()">Both</button>',
    '<img src="javascript:x.jpg" alt="a src that nothing follows as a javascript: URL">',
    '<a href="/real.html">Real</a>',
    '<a href="JAVASCRIPT%3aalert()">not a javascript scheme</a>',
  ].join("\n"));
  assert.deepEqual(subj(found), [
    ["href", "a"],
    ["href", "a"],
    ["action", "form"],
    ["src", "iframe"],
    ["formaction", "input"],
    ["formaction", "button"],
    // The button carries both a javascript: formaction and an inline onclick, in document order.
    ["onclick", "button"],
  ]);
  assert.deepEqual(where(found), [[4, 4], [5, 4], [6, 7], [7, 9], [8, 22], [9, 23], [9, 52]]);
  assert.equal(found[0]!.message.includes("javascript: URL"), true);
  assert.equal(found[6]!.message.includes("inline event handler"), true);
});

test("html.inline-handlers: the message names the CSP that blocks the behavior", async () => {
  const [found] = await run(htmlInlineHandlers, '<a href="javascript:toggle()">Toggle</a>');
  assert.match(found!.message, /Content Security Policy/);
  assert.equal(found!.severity, "note");
});
