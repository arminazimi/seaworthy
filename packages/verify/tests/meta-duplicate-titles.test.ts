import assert from "node:assert/strict";
import { test } from "node:test";

import { metaDuplicateTitles } from "../src/checks/meta.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (title: string) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${title}\n</head>\n<body><h1>t</h1></body>\n</html>\n`;
const T = (text: string) => `<title>${text}</title>`;
const NO_TITLE = "<p>no title here</p>";
const EMPTY_TITLE = "<title>   </title>";
const REDIRECT = '<meta http-equiv="refresh" content="0; url=/next.html">' + T("Home");

async function findings(files: Record<string, string>) {
  const result = await runChecks({ site: buildSite(makeSite(files)), checks: [metaDuplicateTitles] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("meta.duplicate-titles reports one finding per shared title, listing the pages", async () => {
  const result = await findings({
    "/index.html": PAGE(T("Untitled site")),
    "/about.html": PAGE(T("Untitled site")),
    "/docs/guide.html": PAGE(T("Guide")),
    "/docs/api.html": PAGE(T("Untitled site")),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.checkId, "meta.duplicate-titles");
  assert.equal(result[0]!.severity, "warning");
  assert.equal(result[0]!.location.file, "about.html");
  assert.equal(result[0]!.location.line, 3);
  assert.equal(result[0]!.location.column, 1);
  assert.equal(result[0]!.fix.kind, "manual");
  assert.equal(result[0]!.fix.edits.length, 0);
  assert.match(result[0]!.message, /The title "Untitled site" appears on 3 pages \(\/about\.html, \/docs\/api\.html, \/index\.html\)/);
});

test("meta.duplicate-titles skips pages with no title, an empty one, or a redirect stub", async () => {
  const files = {
    "/index.html": PAGE(REDIRECT),
    "/about.html": PAGE(T("Home")),
    "/one.html": PAGE(NO_TITLE),
    "/two.html": PAGE(NO_TITLE),
    "/three.html": PAGE(EMPTY_TITLE),
    "/four.html": PAGE(EMPTY_TITLE),
  };
  assert.deepEqual(await findings(files), []);
});

test("meta.duplicate-titles treats titles that differ only in whitespace as the same", async () => {
  const result = await findings({
    "/index.html": PAGE(T("Home   Page")),
    "/about.html": PAGE(T("  Home Page ")),
  });
  assert.equal(result.length, 1);
  assert.match(result[0]!.message, /title "Home Page"/);
});

test("meta.duplicate-titles lists at most five pages, then how many more", async () => {
  const files: Record<string, string> = {};
  for (const name of ["a", "b", "c", "d", "e", "f", "g"]) files[`/${name}.html`] = PAGE(T("Same"));
  const result = await findings(files);
  assert.equal(result.length, 1);
  assert.match(result[0]!.message, /appears on 7 pages \(\/a\.html, \/b\.html, \/c\.html, \/d\.html, \/e\.html, and 2 more\)/);
});

test("meta.duplicate-titles keeps a stable fingerprint for the same site", async () => {
  const files = { "/about.html": PAGE(T("Home")), "/index.html": PAGE(T("Home")) };
  const [one] = (await findings(files)).map((f) => f.fingerprint);
  const [two] = (await findings({ "/index.html": PAGE(T("Home")), "/blog.html": PAGE(T("Home")) })).map((f) => f.fingerprint);
  // The fingerprint names the reported page, so it may change when that page changes; the same site must not.
  const [again] = (await findings(files)).map((f) => f.fingerprint);
  assert.equal(again, one, "the same site reports the same fingerprint");
  assert.notEqual(two, one, "a different set of affected pages reports a different fingerprint");
});
