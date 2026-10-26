import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlCharset } from "../src/checks/html.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import type { Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = (head: string) => `<!doctype html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body>\n<h1>Page</h1>\n</body>\n</html>\n`;
const DECLARATION = '<meta charset="utf-8">';
const PREFIX = (padding: number) => `<!doctype html>\n<html lang="en">\n<head>\n<!--${"x".repeat(padding)}-->\n`;
const PAGE_WITH_PADDING = (padding: number) => `${PREFIX(padding)}${DECLARATION}\n<title>Boundary</title>\n</head>\n<body>\n<h1>Boundary</h1>\n</body>\n</html>\n`;
const endByte = (padding: number) => Buffer.byteLength(`${PREFIX(padding)}${DECLARATION}`, "utf8");
const paddingFor = (target: number) => target - endByte(0);

async function run(files: Record<string, string | Buffer>): Promise<Finding[]> {
  const result = await runChecks({ site: buildSite(makeSite(files)), checks: [htmlCharset] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("html.charset reports a missing declaration and suggests the first tag in head", async () => {
  const [finding] = await run({ "index.html": PAGE("<title>No encoding</title>") });
  assert.equal(finding!.checkId, "html.charset");
  assert.equal(finding!.severity, "error");
  assert.match(finding!.message, /does not declare its character encoding/);
  assert.deepEqual([finding!.location.file, finding!.location.line, finding!.location.column], ["index.html", 3, 1]);
  assert.equal(finding!.fix.kind, "edit");
  assert.deepEqual(finding!.fix.edits, [{ file: "index.html", line: 3, action: "replace", find: "<head>", replace: '<head><meta charset="utf-8">' }]);
});

test("html.charset withholds the edit when the file is not valid UTF-8", async () => {
  const page = Buffer.from(PAGE('<title>Windows-1252 (\xE9)</title>'), "latin1");
  const [finding] = await run({ "index.html": page });
  assert.equal(finding!.checkId, "html.charset");
  assert.equal(finding!.message, "The page does not declare its character encoding.");
  assert.equal(finding!.fix.kind, "manual");
  assert.deepEqual(finding!.fix.edits, []);
  assert.match(finding!.fix.summary, /could not be confirmed as UTF-8/);
});

test("html.charset keeps the edit when a valid UTF-8 page contains U+FFFD literally", async () => {
  const [finding] = await run({ "index.html": PAGE("<title>Replacement character \uFFFD</title>") });
  assert.equal(finding!.fix.kind, "edit");
});

test("html.charset accepts both declaration forms when they are early", async () => {
  assert.deepEqual(
    await run({
      "charset.html": PAGE('<meta charset="utf-8">\n<title>Charset</title>'),
      "content-type.html": PAGE('<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n<title>Content type</title>'),
    }),
    [],
  );
});

test("html.charset treats empty declaration values as missing", async () => {
  const found = await run({
    "empty-charset.html": PAGE('<meta charset="">\n<title>Empty</title>'),
    "empty-content.html": PAGE('<meta http-equiv="content-type" content="text/html; charset=">\n<title>Empty</title>'),
  });
  assert.deepEqual(
    found.map((f) => f.location.file),
    ["empty-charset.html", "empty-content.html"],
  );
});

test("html.charset accepts a declaration ending exactly at byte 1,024", async () => {
  assert.equal(endByte(paddingFor(1024)), 1024);
  assert.deepEqual(await run({ "index.html": PAGE_WITH_PADDING(paddingFor(1024)) }), []);
});

test("html.charset reports a declaration ending one byte after the limit", async () => {
  assert.equal(endByte(paddingFor(1025)), 1025);
  const [finding] = await run({ "index.html": PAGE_WITH_PADDING(paddingFor(1025)) });
  assert.match(finding!.message, /ends at byte 1025, after the first 1,024 bytes/);
  assert.deepEqual([finding!.location.line, finding!.location.column], [5, 1]);
});

test("html.charset counts bytes, not characters, before the declaration", async () => {
  const page = `<!doctype html>\n<html lang="en">\n<head>\n<!--${"é".repeat(600)}-->\n${DECLARATION}\n<title>Multibyte</title>\n</head>\n<body></body>\n</html>\n`;
  assert.ok(page.indexOf(DECLARATION) < 1024, "the declaration starts within the first 1,024 characters");
  const [finding] = await run({ "index.html": page });
  const end = Number(/ends at byte (\d+)/.exec(finding!.message)?.[1]);
  assert.ok(end > 1024, `the declaration ends after the byte limit: ${finding!.message}`);
});

test("html.charset accepts a leading UTF-8 BOM", async () => {
  assert.deepEqual(await run({ "index.html": `\uFEFF${PAGE("<title>BOM</title>")}` }), []);
});

test("html.charset applies the byte limit to the legacy declaration form", async () => {
  const page = `<!doctype html>\n<html lang="en">\n<head>\n<!--${"x".repeat(1100)}-->\n<meta http-equiv="content-type" content="text/html; charset=utf-8">\n<title>Late legacy</title>\n</head>\n<body></body>\n</html>\n`;
  const [finding] = await run({ "index.html": page });
  assert.match(finding!.message, /after the first 1,024 bytes/);
});

test("html.charset gives a manual fix when there is no head tag to anchor the insertion", async () => {
  const [finding] = await run({ "index.html": "<title>Fragment</title>\n<p>No head element in the source.</p>\n" });
  assert.equal(finding!.fix.kind, "manual");
  assert.deepEqual(finding!.fix.edits, []);
});
