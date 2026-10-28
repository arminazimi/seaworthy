import assert from "node:assert/strict";
import { test } from "node:test";

import { metaTitle } from "../src/checks/meta.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

// A redirect stub skips the content checks, so a page that still shows content must not skip them.
const PAGE = (refresh: string, body: string) => `<!doctype html>\n<html lang="en">\n<head>\n${refresh}\n</head>\n<body>${body}</body>\n</html>\n`;

async function hasFinding(refresh: string, body: string) {
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(refresh, body) })), checks: [metaTitle] });
  assert.deepEqual(result.errors, []);
  return result.findings.some((f) => f.checkId === "meta.title");
}

test("an immediate redirect is still a stub", async () => {
  assert.equal(await hasFinding('<meta http-equiv="refresh" content="0; url=/next.html">', ""), false);
  assert.equal(await hasFinding('<meta HTTP-EQUIV="Refresh" content="0, url=/next.html">', ""), false);
});

test("a delayed redirect is not a stub when the page still shows content", async () => {
  assert.equal(await hasFinding('<meta http-equiv="refresh" content="10; url=/next.html">', "The article moved, reading it again…"), true);
  assert.equal(await hasFinding('<meta http-equiv="refresh" content="10; url=/next.html">', 'keep reading <a href="/old.html">here</a>'), true);
});

test("a delayed redirect with no readable text is still a stub", async () => {
  assert.equal(await hasFinding('<meta http-equiv="refresh" content="10; url=/next.html">', ""), false);
  assert.equal(await hasFinding('<meta http-equiv="refresh" content="10; url=/next.html">', "<script>window.dataLayer=window.dataLayer||[];</script>"), false);
});

test("a delayed reload and refresh values browsers ignore are not stubs", async () => {
  assert.equal(await hasFinding('<meta http-equiv="refresh" content="10">', ""), true);
  for (const refresh of ['<meta http-equiv="refresh">', '<meta http-equiv="refresh" content="">', '<meta http-equiv="refresh" content="soon; url=/next.html">', '<meta http-equiv="refresh" content="5; javascript:void(0)">']) {
    assert.equal(await hasFinding(refresh, ""), true, refresh);
  }
});
