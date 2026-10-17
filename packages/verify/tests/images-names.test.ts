import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { imagesDimensions } from "../src/checks/images.js";
import { namesButton, namesLabel, namesLink } from "../src/checks/names.js";
import { runChecks } from "../src/engine.js";
import { imageSize } from "../src/image-size.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const FIXTURE_IMAGES = fileURLToPath(new URL("../../../../fixtures/broken/images/site/img/", import.meta.url));
const read = (name: string) => readFileSync(join(FIXTURE_IMAGES, name));
const PAGE = (body: string) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

async function run(check: Check, files: Record<string, string | Buffer>): Promise<Finding[]> {
  const site = buildSite(makeSite(files as Record<string, string>));
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("imageSize reads PNG, GIF, JPEG, and WebP headers", () => {
  assert.deepEqual(imageSize(read("a.png")), { width: 40, height: 30 });
  assert.deepEqual(imageSize(read("b.gif")), { width: 20, height: 10 });
  assert.deepEqual(imageSize(read("c.jpg")), { width: 64, height: 48 }, "the JPEG has an APP0 segment before its frame header");
  assert.deepEqual(imageSize(read("d.webp")), { width: 100, height: 50 });
});

test("imageSize reads lossy and lossless WebP", () => {
  const riff = (kind: string, body: Buffer) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from(`WEBP${kind}`), Buffer.alloc(4), body]);
  const lossy = Buffer.alloc(18);
  lossy.writeUInt16LE(321, 14 - 4 + 4 - 4 + 4 - 4 + 0); // placeholder, overwritten below
  const lossyBody = Buffer.alloc(18);
  lossyBody.writeUInt16LE(321, 6); // offset 26 of the file
  lossyBody.writeUInt16LE(123, 8); // offset 28
  assert.deepEqual(imageSize(riff("VP8 ", lossyBody)), { width: 321, height: 123 });
  const losslessBody = Buffer.alloc(18);
  losslessBody.writeUInt32LE(((200 - 1) | ((100 - 1) << 14)) >>> 0, 1); // offset 21 of the file
  assert.deepEqual(imageSize(riff("VP8L", losslessBody)), { width: 200, height: 100 });
});

test("imageSize returns undefined for unknown, truncated, or empty data instead of guessing", () => {
  assert.equal(imageSize(Buffer.alloc(0)), undefined);
  assert.equal(imageSize(Buffer.from("not an image at all, just text")), undefined);
  assert.equal(imageSize(read("a.png").subarray(0, 20)), undefined, "truncated PNG");
  assert.equal(imageSize(read("c.jpg").subarray(0, 12)), undefined, "truncated JPEG");
  const zero = Buffer.from(read("a.png"));
  zero.writeUInt32BE(0, 16);
  assert.equal(imageSize(zero), undefined, "zero width");
});

test("images.dimensions computes the exact attributes from the real file", async () => {
  const found = await run(imagesDimensions, {
    "index.html": PAGE('<img src="/a.png" alt="x">\n<img src="/b.gif" alt="x" width="20">\n<img src="/c.jpg" alt="x" height="24">'),
    "a.png": read("a.png"),
    "b.gif": read("b.gif"),
    "c.jpg": read("c.jpg"),
  });
  assert.deepEqual(found.map((f) => [f.fix.edits[0]!.find, f.fix.edits[0]!.replace]), [
    ['src="/a.png"', 'src="/a.png" width="40" height="30"'],
    ['src="/b.gif"', 'src="/b.gif" height="10"'],
    ['src="/c.jpg"', 'src="/c.jpg" width="32"'],
  ]);
  assert.match(found[0]!.fix.summary, /width="40" height="30" \(the image is 40×30\)/);
});

test("images.dimensions gives a manual fix when the size cannot be read", async () => {
  const [remote, unknown] = await run(imagesDimensions, { "index.html": PAGE('<img src="https://cdn.test/a.png" alt="x">\n<img src="/notimage.png" alt="x">'), "notimage.png": "just text" });
  for (const f of [remote!, unknown!]) {
    assert.equal(f.fix.kind, "manual");
    assert.deepEqual(f.fix.edits, []);
  }
});

test("images.dimensions skips data URIs, inline-sized images, and images with both attributes", async () => {
  const found = await run(imagesDimensions, {
    "index.html": PAGE(['<img src="data:image/gif;base64,AAAA" alt="">', '<img src="/a.png" alt="" style="aspect-ratio: 4 / 3">', '<img src="/a.png" alt="" style="width: 40px; height: 30px">', '<img src="/a.png" alt="" width="40" height="30">', '<img src="/a.png" alt="" width="40px" height="30px">'].join("\n")),
    "a.png": read("a.png"),
  });
  assert.deepEqual(found, []);
});

test("images.dimensions rejects zero and non-numeric sizes", async () => {
  const found = await run(imagesDimensions, { "index.html": PAGE('<img src="/a.png" alt="" width="0" height="30">\n<img src="/a.png" alt="" width="auto" height="30">'), "a.png": read("a.png") });
  assert.equal(found.length, 2);
});

test("names.label accepts every real way of naming a field", async () => {
  const found = await run(namesLabel, {
    "index.html": PAGE(
      [
        '<label for="a">A</label><input id="a">',
        "<label>Wrapped <span><input></span></label>",
        '<input aria-label="B">',
        '<span id="lbl">C</span><input aria-labelledby="lbl">',
        '<input title="D">',
        '<input type="hidden">',
        '<input type="submit">',
        '<input type="checkbox" id="c"><label for="c">Check</label>',
        '<select hidden></select>',
      ].join("\n"),
    ),
  });
  assert.deepEqual(found, []);
});

test("names.label: a label pointing at a missing id, or aria-labelledby at nothing, is not a name", async () => {
  const found = await run(namesLabel, { "index.html": PAGE('<label for="nothing">X</label><input id="a">\n<input aria-labelledby="ghost">\n<input aria-label="  ">') });
  assert.equal(found.length, 3);
});

test("names.button and names.link read names the way assistive technology does", async () => {
  const buttons = await run(namesButton, {
    "index.html": PAGE(['<button>Save</button>', '<button><span> </span></button>', '<button><img src="i.png" alt="Save"></button>', '<button><svg><title>Close</title></svg></button>', '<button aria-label="Menu"></button>', '<button title="Help"></button>', '<input type="submit">', '<input type="reset">', '<input type="button">', '<input type="button" value="Go">', '<input type="image" src="i.png" alt="Search">', '<input type="image" src="i.png">'].join("\n")),
  });
  assert.deepEqual(buttons.map((f) => f.location.line), [6, 13, 16], "only the empty button, the nameless input button, and the alt-less image input");
  const links = await run(namesLink, {
    "index.html": PAGE(['<a href="/a">Docs</a>', '<a href="/a"><img src="i.png" alt="Docs"></a>', '<a href="/a"><img src="i.png" alt=""></a>', '<a href="/a"> </a>', '<a href="/a" aria-label="Docs"></a>', '<a name="x"></a>', '<a href="/a" aria-hidden="true"></a>'].join("\n")),
  });
  assert.deepEqual(links.map((f) => f.location.line), [7, 8]);
  assert.match(links[0]!.message, /announces only "link"/);
});

test("edits anchor on one attribute and compose: two checks can fix the same image in either order", async () => {
  const { imagesAlt } = await import("../src/checks/images.js");
  const files = { "index.html": PAGE('<img src="/a.png">'), "a.png": read("a.png") };
  const alt = (await run(imagesAlt, files))[0]!.fix.edits[0]!;
  const dims = (await run(imagesDimensions, files))[0]!.fix.edits[0]!;
  assert.equal(alt.find, dims.find, "both anchor on the same existing attribute");
  const apply = (line: string, ...edits: typeof alt[]) => edits.reduce((l, e) => l.replace(e.find, () => e.replace), line);
  const line = '<img src="/a.png">';
  assert.equal(apply(line, alt, dims), '<img src="/a.png" width="40" height="30" alt="<describe the image>">');
  assert.equal(apply(line, dims, alt), '<img src="/a.png" alt="<describe the image>" width="40" height="30">');
});

test("an edit is withheld when its text is not unique on the line, instead of risking the wrong element", async () => {
  const { imagesAlt } = await import("../src/checks/images.js");
  const [first, second] = await run(imagesAlt, { "index.html": PAGE('<img src="/same.png"> <img src="/same.png">\n<img src="/one.png">') });
  assert.deepEqual([first!.fix.kind, second!.fix.kind], ["manual", "manual"], "the same image twice on one line is ambiguous");
  const [third] = (await run(imagesAlt, { "index.html": PAGE('<img src="/same.png"> <img src="/same.png">\n<img src="/one.png">') })).slice(2);
  assert.equal(third!.fix.kind, "edit", "a unique one on its own line still gets an edit");
});

test("a tag spread over several lines still gets an edit, anchored on an attribute's own line", async () => {
  const { imagesAlt } = await import("../src/checks/images.js");
  const [f] = await run(imagesAlt, { "index.html": PAGE('<img\n  src="/a.png"\n  width="40"\n>') });
  assert.deepEqual(f!.fix.edits, [{ file: "index.html", line: 6, action: "replace", find: 'src="/a.png"', replace: 'src="/a.png" alt="<describe the image>"', needsInput: true }]);
});
