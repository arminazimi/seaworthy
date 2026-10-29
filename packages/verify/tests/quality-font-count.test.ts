import assert from "node:assert/strict";
import { test } from "node:test";

import { qualityFontCount } from "../src/checks/font-count.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const page = (headExtra: string) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>t</title>\n${headExtra}\n</head>\n<body><main><p>reading matter for the page</p></main></body>\n</html>\n`;

/** @font-face rules pulling in exactly these URLs, one per line. */
const cssOf = (urls: string[]) => urls.map((url) => `@font-face{font-family:F;src:url(${url}) format("woff2")}\n`).join("");
/** Placeholder bytes for a list of site paths, as makeSite file entries. */
const fontFiles = (paths: string[]) => Object.fromEntries(paths.map((p) => [p.slice(1), "font bytes"]));

/** A two-page site: index.html loads /a.css, other.html loads nothing; `files` override any path. */
async function run(files: Record<string, string>, options?: Record<string, unknown>) {
  const result = await runChecks({
    site: buildSite(makeSite({ "index.html": page('<link rel="stylesheet" href="/a.css">'), "other.html": page(""), ...files })),
    checks: [qualityFontCount],
    ...(options ? { options: { "quality.font-count": options } } : {}),
  });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

const SEVEN = ["/f/g.woff2", "/f/a.woff2", "/f/b.woff", "/f/c.ttf", "/f/d.otf", "/f/e.woff2", "/f/h.eot"];

test("quality.font-count: one finding per page over the default maximum, with the sorted font paths", async () => {
  const findings = await run({ "a.css": cssOf(SEVEN), ...fontFiles(SEVEN) });
  assert.equal(findings.length, 1);
  const finding = findings[0]!;
  assert.equal(finding.checkId, "quality.font-count");
  assert.equal(finding.severity, "warning");
  assert.deepEqual(finding.location, { file: "index.html", line: 3, column: 1 }, "the count comes from a linked stylesheet, so the finding sits at the <head>");
  assert.equal(finding.message, "index.html pulls in 7 distinct font files, over the maximum of 6: /f/a.woff2, /f/b.woff, /f/c.ttf, /f/d.otf, /f/e.woff2, /f/g.woff2, /f/h.eot.");
  assert.deepEqual(finding.fix.edits, []);
  assert.equal(finding.fix.kind, "manual");
});

test("quality.font-count: a page at or under the maximum is silent", async () => {
  const six = SEVEN.slice(0, 6);
  assert.deepEqual(await run({ "a.css": cssOf(six), ...fontFiles(six) }), []);
  assert.deepEqual(await run({ "a.css": cssOf(["/f/a.woff2"]), ...fontFiles(["/f/a.woff2"]) }), []);
});

test("quality.font-count: a page with no fonts at all is silent", async () => {
  assert.deepEqual(await run({ "a.css": "p{color:rebeccapurple}\n" }), []);
});

test("quality.font-count: the same file twice counts once, across two linked stylesheets", async () => {
  const findings = await run(
    {
      "index.html": page('<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css">'),
      "a.css": cssOf(["/f/a.woff2", "/f/b.woff2"]),
      "b.css": cssOf(["/f/b.woff2?v=2", "/f/c.woff2"]),
      ...fontFiles(["/f/a.woff2", "/f/b.woff2", "/f/c.woff2"]),
    },
    { max: 2 },
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /pulls in 3 distinct font files, over the maximum of 2: \/f\/a\.woff2, \/f\/b\.woff2, \/f\/c\.woff2/, "four references, one with a query string, are three distinct files");
});

test("quality.font-count: inline <style> fonts count too, and the finding sits at the <style> element when only it carries fonts", async () => {
  const findings = await run({ "index.html": page(`<style>${cssOf(["/f/a.woff2", "/f/b.woff2"])}</style>`), ...fontFiles(["/f/a.woff2", "/f/b.woff2"]) }, { max: 1 });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0]!.location, { file: "index.html", line: 6, column: 1 });
  assert.match(findings[0]!.message, /pulls in 2 distinct font files/);
});

test("quality.font-count: the max option overrides the default", async () => {
  assert.deepEqual(await run({ "a.css": cssOf(SEVEN), ...fontFiles(SEVEN) }, { max: 10 }), []);
  const findings = await run({ "a.css": cssOf(["/f/a.woff2", "/f/b.woff2"]), ...fontFiles(["/f/a.woff2", "/f/b.woff2"]) }, { max: 1 });
  assert.equal(findings.length, 1, "two fonts are over a maximum of 1");
});

test("quality.font-count: an unusable max falls back to the default of 6", async () => {
  for (const bad of [0, -3, 1.5, Number.NaN, "3", null, undefined, true]) {
    assert.equal((await run({ "a.css": cssOf(SEVEN), ...fontFiles(SEVEN) }, { max: bad })).length, 1, `max ${JSON.stringify(bad)}: seven fonts still exceed the default 6`);
    assert.deepEqual(await run({ "a.css": cssOf(SEVEN.slice(0, 6)), ...fontFiles(SEVEN.slice(0, 6)) }, { max: bad }), [], `max ${JSON.stringify(bad)}: six fonts stay under the default`);
  }
});

test("quality.font-count: fonts not in the built site are not counted — that is assets.missing's finding", async () => {
  const urls = ["/f/a.woff2", "/f/missing.woff2", "/f/gone.ttf", "https://cdn.example.test/x.woff2", "data:font/woff2;base64,AAAA"];
  const findings = await run({ "a.css": cssOf(urls), ...fontFiles(["/f/a.woff2"]) }, { max: 1 });
  assert.deepEqual(findings, [], "one real font file is not over a maximum of 1");
  const over = await run({ "a.css": cssOf([...urls, "/f/b.woff2"]), ...fontFiles(["/f/a.woff2", "/f/b.woff2"]) }, { max: 1 });
  assert.equal(over.length, 1);
  assert.doesNotMatch(over[0]!.message, /missing|gone|cdn|data:/, "the message lists only the two files the build serves");
});
