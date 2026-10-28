import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprint, runChecks } from "../src/engine.js";
import { rtlBidi } from "../src/checks/rtl.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = (html: string, body: string, style?: string, head = "") =>
  `<!doctype html>\n${html}\n<head><title>t</title>${head}${style ? `<style>\n${style}\n</style>` : ""}</head>\n<body>\n${body}\n</body></html>\n`;

const FP = (file: string, key: string) => fingerprint("rtl.bidi", file, key);

async function run(check: Check, files: Record<string, string>): Promise<Finding[]> {
  const site = buildSite(makeSite(files));
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

const positions = (found: Finding[]) => found.map((f) => [f.location.file, f.location.line, f.location.column]);

test("rtl.bidi: RTL lang with no dir, unscoped mixed text, and physical CSS each report once with exact locations", async () => {
  const found = await run(rtlBidi, {
    "index.html": PAGE(
      '<html lang="ar">',
      "<p>السلام عليكم: hello</p>",
      ".card { margin-left: 12px; }\n.card2 { text-align: left; }",
    ),
    "styles/site.css": ".aside { float: left; padding-right: 8px; }",
  });
  assert.equal(found.length, 4, "one dir finding, one mixed-text note, two physical declarations");
  assert.deepEqual(found.map((f) => f.fingerprint), [
    FP("index.html", "dir"),
    FP("index.html", "mixed:p:السلام عليكم: hello"),
    FP("index.html", "index.html#margin-left"),
    FP("index.html", "index.html#text-align"),
  ]);
  assert.deepEqual(found.map((f) => f.severity), ["warning", "note", "note", "note"]);
  assert.equal(found.filter((f) => f.fix.kind === "edit").length, 3, "the dir finding and both declarations carry edits; the mixed run is manual");
});

test("rtl.bidi: the dir edit adds dir=rtl; the CSS edits rename property and keyword", async () => {
  const found = await run(rtlBidi, {
    "index.html": PAGE('<html lang="ar">', "<p>نص</p>", ".card { margin-left: 12px; }\n.card2 { text-align: left; }"),
  });
  const edits = found.flatMap((f) => f.fix.edits ?? []);
  assert.deepEqual(
    edits.map((e) => [e.find, e.replace]),
    [["lang=\"ar\"", "lang=\"ar\" dir=\"rtl\""], ["margin-left", "margin-inline-start"], ["left", "start"]],
  );
  assert.deepEqual(edits.map((e) => e.line), [2, 4, 5]);
});

test("rtl.bidi: a linked internal stylesheet reports under its own file path", async () => {
  const found = await run(rtlBidi, {
    "index.html": PAGE('<html lang="he" dir="rtl">', "<p>טקסט</p>", "", '<link rel="stylesheet" href="main.css">'),
    "main.css": ".nav { border-left: 1px solid black; }",
  });
  assert.equal(found.length, 1);
  assert.deepEqual(positions(found), [["main.css", 1, 8]]);
});

test("rtl.bidi: clean input stays silent", async () => {
  const found = await run(rtlBidi, {
    "index.html": PAGE('<html lang="ar" dir="rtl">', "<p dir=\"ltr\">English</p>", ".card { margin-inline-start: 12px; text-align: start; }"),
    "main.css": ".nav { clear: inline-end; text-align: end; float: inline-start; padding-left: 4px; }",
  });
  assert.deepEqual(found, [], "dir is declared and every declaration is logical");
});

test("rtl.bidi: a scoped mixed run and a deliberate dir=ltr page are not reports", async () => {
  const found = await run(rtlBidi, {
    "index.html": PAGE('<html lang="ar" dir="ltr">', "<p>مرحبا <bdi>margins</bdi></p>", "a { margin-right: 2px; }"),
    "other.html": PAGE('<html lang="en" dir="ltr">', '<p>Hebrew name שלום with Latin</p>', ""),
  });
  assert.deepEqual(found, [], "dir=ltr is deliberate; dir=rtl scopes the run; an LTR page is out of scope");
});

test("rtl.bidi: keyword values with !important and comments are handled; selector look-alikes are not", async () => {
  const found = await run(rtlBidi, {
    "index.html": PAGE(
      '<html lang="ur" dir="rtl">',
      "<p>نص</p>",
      "/* margin-left: 4px; in a comment */\n.text { float: left !important; }\n.margin-left:hover { color: red; }\n.a { content: 'margin-left: 3px'; }",
    ),
  });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.message.includes("float"), true);
});

test("rtl.bidi: shared stylesheets report once, not once per linking page", async () => {
  const found = await run(rtlBidi, {
    "a.html": PAGE('<html lang="fa" dir="rtl">', "<p style=\"margin-left:1px\">x</p>", ""),
    "b.html": PAGE('<html lang="fa" dir="rtl">', "<p>x</p>", ""),
  });
  assert.equal(found.length, 0, "physical declarations live in page CSS, not inline style attributes");
});
