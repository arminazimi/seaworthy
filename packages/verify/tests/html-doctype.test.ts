import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlDoctype } from "../src/checks/html.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (doctype: string) => `${doctype}\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title></head>\n<body><p>x</p></body>\n</html>\n`;

async function findings(files: Record<string, string>) {
  const result = await runChecks({ site: buildSite(makeSite(files)), checks: [htmlDoctype] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("html.doctype is a warning and needs only HTML", () => {
  assert.equal(htmlDoctype.meta.id, "html.doctype");
  assert.equal(htmlDoctype.meta.severity, "warning");
  assert.deepEqual(htmlDoctype.meta.needs, ["html"]);
});

test("html.doctype accepts the standard doctype in any case", async () => {
  assert.deepEqual(await findings({ "index.html": PAGE("<!doctype html>") }), []);
  assert.deepEqual(await findings({ "index.html": PAGE("<!DOCTYPE HTML>") }), []);
});

test("html.doctype accepts the legacy-compat system form", async () => {
  assert.deepEqual(await findings({ "index.html": PAGE('<!DOCTYPE html SYSTEM "about:legacy-compat">') }), []);
  assert.deepEqual(await findings({ "index.html": PAGE("<!doctype html system 'about:legacy-compat'>") }), []);
});

test("html.doctype accepts a doctype after whitespace, a byte order mark, comments, and an XML declaration", async () => {
  const withComment = `<!-- generated on 2026-01-01 -->\n<!doctype html>\n<html lang="en"><head><title>t</title></head><body></body></html>\n`;
  assert.deepEqual(await findings({ "index.html": withComment }), []);
  const withBom = `\uFEFF\n<!doctype html>\n<html lang="en"><head><title>t</title></head><body></body></html>\n`;
  assert.deepEqual(await findings({ "index.html": withBom }), []);
  const withXml = `<?xml version="1.0" encoding="utf-8"?>\n<!doctype html>\n<html lang="en"><head><title>t</title></head><body></body></html>\n`;
  assert.deepEqual(await findings({ "index.html": withXml }), []);
});

test("html.doctype reports a missing doctype and offers to insert one", async () => {
  const page = '<html lang="en"><head><title>t</title></head><body><p>x</p></body></html>\n';
  const found = await findings({ "index.html": page });
  assert.equal(found.length, 1);
  const [finding] = found;
  assert.match(finding!.message, /no doctype.*quirks/);
  assert.equal(finding!.location.file, "index.html");
  assert.equal(finding!.location.line, 1);
  assert.equal(finding!.fix.kind, "edit");
  const [edit] = finding!.fix.edits;
  assert.deepEqual(edit, { file: "index.html", line: 1, action: "replace", find: "<html", replace: "<!doctype html>\n<html" });
});

test("html.doctype reports a doctype a browser would ignore", async () => {
  const page = '<head><title>t</title></head>\n<!doctype html>\n<html lang="en"><body><p>x</p></body></html>\n';
  const found = await findings({ "index.html": page });
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /no doctype before its first element.*quirks/);
  assert.match(found[0]!.message, /quirks mode/);
});

test("html.doctype reports a doctype a browser cannot recognize, at its position", async () => {
  const found = await findings({ "index.html": PAGE('<!doctype body>') });
  assert.equal(found.length, 1);
  const [finding] = found;
  assert.match(finding!.message, /declares body.*quirks mode/);
  assert.deepEqual([finding!.location.line, finding!.location.column], [1, 1]);
  assert.equal(finding!.severity, "warning");
  assert.equal(finding!.fix.kind, "edit");
  assert.deepEqual(finding!.fix.edits[0], { file: "index.html", line: 1, action: "replace", find: "<!doctype body>", replace: "<!doctype html>" });
});

test("html.doctype reports a legacy doctype as a note, even when the file is otherwise valid", async () => {
  const found = await findings({
    "index.html": PAGE('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">'),
  });
  assert.equal(found.length, 1);
  const [finding] = found;
  assert.match(finding!.message, /legacy/);
  assert.equal(finding!.severity, "note");
  assert.match(finding!.fix.summary, /<!doctype html>/);
});

test("html.doctype locates the doctype when comments precede it", async () => {
  const page = '<!-- generated on 2026-01-01 -->\n<!doctype body bilateral>\n<html lang="en"><head><title>t</title></head><body></body></html>\n';
  const found = await findings({ "index.html": page });
  const [finding] = found;
  assert.deepEqual([finding!.location.line, finding!.location.column], [2, 1]);
});
