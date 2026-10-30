// md.images: images in Markdown sources that point at missing files, and images with no alt text.

import assert from "node:assert/strict";
import { test } from "node:test";

import { mdImages } from "../src/checks/md-images.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { runChecks } from "../src/engine.js";
import { makeSite } from "./helpers.js";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

async function findings(files: Record<string, string | Buffer>): Promise<Finding[]> {
  const site = buildSite(makeSite(files));
  const result = await runChecks({ site, checks: [mdImages as Check] });
  assert.deepEqual(result.errors, [], "no check may crash");
  return result.findings;
}

test("md.images reports a Markdown image whose file is not in the site, at the Markdown line", async () => {
  const [f] = await findings({
    "notes.md": "# Notes\n\nThe chart was never committed: ![Q1 chart](charts/q1.png)\n",
  });
  assert.equal(f!.checkId, "md.images");
  assert.equal(f!.severity, "error");
  assert.equal(f!.message, "Image to charts/q1.png points at a file that does not exist in the site.");
  assert.deepEqual(f!.location, { file: "notes.md", line: 3 });
  assert.equal(f!.fix.kind, "manual");
  assert.match(f!.fix.summary, /Create charts\/q1\.png, or point the image at a file that exists\./);
  assert.deepEqual(f!.fix.edits, []);
});

test("md.images offers an exact edit when one file in the site has the missing basename", async () => {
  const [f] = await findings({
    "img/logo.png": PNG,
    "notes.md": "After a folder move: ![Logo](images/logo.png)\n",
  });
  assert.equal(f!.fix.kind, "edit");
  assert.deepEqual(f!.fix.edits, [{ file: "notes.md", line: 1, action: "replace", find: "images/logo.png", replace: "img/logo.png" }]);
  assert.match(f!.fix.summary, /Point the image at img\/logo\.png, the only file named logo\.png/);
});

test("the basename repair keeps the style (relative or root-absolute) of the src as written", async () => {
  const out = await findings({
    "img/logo.png": PNG,
    "notes.md": "![a](/images/logo.png)\n![b](images/logo.png)\n",
  });
  assert.deepEqual(out.map((f) => [f.location.line, f.fix.kind, f.fix.edits[0]?.replace]), [
    [1, "edit", "/img/logo.png"],
    [2, "edit", "img/logo.png"],
  ]);
});

test("basename matching ignores case, and several matches mean no guess", async () => {
  const [one] = await findings({ "img/Logo.PNG": PNG, "notes.md": "![x](logo.png)\n" });
  assert.equal(one!.fix.kind, "edit");
  assert.equal(one!.fix.edits[0]!.replace, "img/Logo.PNG");
  const [two] = await findings({ "img/logo.png": PNG, "brand/logo.png": PNG, "notes.md": "![x](logo.png)\n" });
  assert.equal(two!.fix.kind, "manual", "two files share the basename: never guess between them");
  assert.deepEqual(two!.fix.edits, []);
});

test("an image resolving next to its own file passes; a duplicate anchor on the line declines the edit", async () => {
  const ok = await findings({ "img/logo.png": PNG, "img/index.md": "![Logo](logo.png)\n" });
  assert.deepEqual(ok, []);
  const [twice] = await findings({
    "img/logo.png": PNG,
    "notes.md": "![a](images/logo.png) then again ![b](images/logo.png)\n",
  });
  assert.equal(twice!.fix.kind, "manual", "the anchor is not unique on the line");
  assert.deepEqual(twice!.fix.edits, []);
});

test("external, protocol-relative, and data or ignored sources never fire the missing-file rule", async () => {
  const out = await findings({
    "notes.md": [
      "![Remote](https://cdn.example.com/gone.png)",
      "",
      "![Tracker](//cdn.example.com/gone.png)",
      "",
      "![Inline](data:image/png;base64,AAAA)",
      "",
      "![Empty]()",
      "",
      '<img src="//cdn.example.com/gone.png" alt="A badge">',
      "",
      '<img src="data:image/png;base64,AAAA" alt="An inline dot">',
      "",
    ].join("\n"),
  });
  assert.deepEqual(out, []);
});

test("an <img> written as raw HTML in Markdown and given no alt attribute is reported", async () => {
  const [f] = await findings({
    "img/photo.png": PNG,
    "notes.md": "# Notes\n\n<img src=\"img/photo.png\" width=\"600\">\n",
  });
  assert.equal(f!.severity, "error");
  assert.equal(f!.message, '<img src="img/photo.png"> has no alt attribute.');
  assert.deepEqual(f!.location, { file: "notes.md", line: 3 });
  assert.equal(f!.fix.kind, "edit");
  assert.deepEqual(f!.fix.edits, [{ file: "notes.md", line: 3, action: "replace", find: '<img src="img/photo.png" width="600">', replace: '<img src="img/photo.png" width="600" alt="<describe the image>">', needsInput: true }]);
});

test("deliberate decoration passes: alt=\"\" in a tag, and empty alt in Markdown syntax", async () => {
  const out = await findings({
    "img/spacer.png": PNG,
    "notes.md": ['<img src="img/spacer.png" alt="">', "", "![](img/spacer.png)", "", "![ ](img/spacer.png)", "", '<img src="img/spacer.png" alt="A spacer">', ""].join("\n"),
  });
  assert.deepEqual(out, []);
});

test("images hidden from readers are exempt, exactly like images.alt exempts them in HTML", async () => {
  const out = await findings({
    "img/divider.png": PNG,
    "notes.md": ['<img src="img/divider.png" role="presentation">', '<img src="img/divider.png" role="NONE">', '<img src="img/divider.png" aria-hidden="true">', '<img src="img/divider.png" aria-label="A divider">', '<img src="img/divider.png" aria-labelledby="t1">', ""].join("\n"),
  });
  assert.deepEqual(out, []);
});

test("a remote image is still an image: the alt rule fires offline, the missing-file rule does not", async () => {
  const out = await findings({
    "notes.md": '<img src="https://cdn.example.com/badge.svg">\n\n<img src="https://cdn.example.com/pixel.gif" alt="">\n\n![Badge](https://cdn.example.com/other.svg)\n',
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.location, { file: "notes.md", line: 1 });
  assert.match(out[0]!.message, /has no alt attribute/);
});

test("a raw <img> with a missing src gets both findings, one per rule", async () => {
  const out = await findings({ "notes.md": '<img src="img/gone.png">\n' });
  assert.deepEqual(out.map((f) => f.message), ["Image to img/gone.png points at a file that does not exist in the site.", '<img src="img/gone.png"> has no alt attribute.']);
  assert.notEqual(out[0]!.fingerprint, out[1]!.fingerprint, "one stable identity per rule");
});

test("code and comments hold no images: fences, indented code, code spans, comments, front matter", async () => {
  const out = await findings({
    "notes.md": [
      "---",
      'title: <img src="meta.png">',
      "---",
      "",
      "```html",
      '<img src="docs.png">',
      "![Fenced](fenced.png)",
      "```",
      "",
      "A block written by indentation:",
      "",
      '    <img src="indented.png">',
      "",
      'Inline `<img src="span.png">` and `![Span](span.png)` are examples.',
      "",
      '<!-- <img src="commented.png"> -->',
      "",
      "<!--",
      '<img src="multiline-comment.png">',
      "-->",
      "",
      "Real: ![Real](real.png)",
      "",
    ].join("\n"),
  });
  assert.equal(out.length, 1, "only the last line is markup a reader sees");
  assert.deepEqual(out[0]!.location, { file: "notes.md", line: 22 });
});

test("a link wrapped around an image is one image: its src is checked, the link is md.links business", async () => {
  const out = await findings({ "notes.md": "[![Badge](gone.png)](https://example.com)\n" });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.message, "Image to gone.png points at a file that does not exist in the site.");
});

test("a reference-style image is reported at the line that uses it, with no guessed edit", async () => {
  const out = await findings({ "notes.md": "See ![Company logo][logo] inline.\n\n[logo]: images/logo.png\n" });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.location, { file: "notes.md", line: 1 });
  assert.equal(out[0]!.fix.kind, "manual", "the definition line holds the path, not the line that uses it");
});

test("an undefined reference label is text, not an image, and `<image>` is not an `<img>`", async () => {
  const out = await findings({ "notes.md": '![No definition][missing] and `<img src="x.png">`.\n\n<svg><image href="icon.svg"/></svg>\n' });
  assert.deepEqual(out, []);
});

test("a tag spanning lines still reports its alt, and declines an edit it cannot anchor", async () => {
  const out = await findings({ "img/photo.png": PNG, "notes.md": '<img\n  src="img/photo.png"\n  width="4">\n' });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.location, { file: "notes.md", line: 1 });
  assert.equal(out[0]!.fix.kind, "manual");
});

test("findings are deterministic: files by path, images in document order", async () => {
  const out = await findings({
    "b.md": "![one](gone1.png) line\n\n![two](gone2.png) line\n",
    "a.md": "![zero](gone0.png) line\n",
  });
  assert.deepEqual(out.map((f) => [f.location.file, f.location.line]), [["a.md", 1], ["b.md", 1], ["b.md", 3]]);
});

test("a raw <img> is repaired and located like a Markdown image, and a bare tag is judged on its alt alone", async () => {
  const [moved] = await findings({ "img/logo.png": PNG, "notes.md": '<img src="images/logo.png" alt="Logo">\n' });
  assert.equal(moved!.fix.kind, "edit");
  assert.deepEqual(moved!.fix.edits, [{ file: "notes.md", line: 1, action: "replace", find: "images/logo.png", replace: "img/logo.png" }]);

  const [bare] = await findings({ "notes.md": "<p>an icon with no src:</p>\n\n<img>\n" });
  assert.equal(bare!.message, "<img> has no alt attribute.");
  assert.deepEqual(bare!.location, { file: "notes.md", line: 3 });
  assert.equal(bare!.fix.kind, "edit");
  assert.deepEqual(bare!.fix.edits, [{ file: "notes.md", line: 3, action: "replace", find: "<img>", replace: '<img alt="<describe the image>">', needsInput: true }]);
  assert.equal((await findings({ "notes.md": "<img alt=\"\">\n" })).length, 0, "alt=\"\" on a src-less tag is still decoration");
});

test("a site with no Markdown files reports nothing and does not crash", async () => {
  const out = await findings({ "index.html": '<!doctype html>\n<html lang="en"><body><img src="gone.png"><img src="x.png" alt=""></body></html>\n' });
  assert.deepEqual(out, []);
});
