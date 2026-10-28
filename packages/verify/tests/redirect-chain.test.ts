// html.redirect-chain: redirect pages that redirect again, forming chains and loops.

import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlRedirectChain } from "../src/checks/meta.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const CONTENT = '<meta http-equiv="refresh" content="5; url=/next.html">';
const REFRESH = (delay: number, url: string) => `<meta http-equiv="refresh" content="${delay}; url=${url}">`;
const PAGE = (redirect: string) => `<!doctype html>\n<html lang="en">\n<head><title>t</title>${redirect}</head>\n<body><h1>t</h1></body>\n</html>\n`;

async function findings(files: Record<string, string>) {
  const result = await runChecks({ site: buildSite(makeSite(files)), checks: [htmlRedirectChain] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("html.redirect-chain reports nothing for a single redirect onto a content page", async () => {
  assert.deepEqual(await findings({ "a.html": PAGE(REFRESH(0, "/b.html")), "b.html": PAGE("") }), []);
});

test("html.redirect-chain reports a chain of three pages at its start, naming the final target", async () => {
  const [only] = await findings({
    "a.html": PAGE(REFRESH(5, "/b.html")),
    "b.html": PAGE(REFRESH(0, "/c.html")),
    "c.html": PAGE(""),
  });
  assert.ok(only);
  assert.equal(only.checkId, "html.redirect-chain");
  assert.equal(only.severity, "warning");
  assert.equal(only.location.file, "a.html");
  assert.match(only.message, /starts a chain of redirects: \/a\.html -> \/b\.html -> \/c\.html/);
  assert.match(only.message, /through 2 redirects/);
  assert.equal(only.fix.kind, "manual");
  assert.match(only.fix.summary, /final destination \/c\.html/);
  assert.equal(only.fix.edits.length, 0);
});

test("html.redirect-chain reports each page that starts a chain, and skips the pages inside it", async () => {
  const result = await findings({
    "a.html": PAGE(REFRESH(2, "/b.html")),
    "b.html": PAGE(REFRESH(3, "/c.html")),
    "c.html": PAGE(""),
    "d.html": PAGE(REFRESH(4, "/b.html")),
  });
  assert.deepEqual(
    result.map((f) => [f.location.file, f.severity]),
    [["a.html", "warning"], ["d.html", "warning"]],
  );
});

test("html.redirect-chain reports a two-page loop once, at its first page, as an error", async () => {
  const result = await findings({
    "a.html": PAGE(REFRESH(1, "/b.html")),
    "b.html": PAGE(REFRESH(2, "/a.html")),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.location.file, "a.html");
  assert.equal(result[0]!.severity, "error");
  assert.match(result[0]!.message, /redirect loop: \/a\.html -> \/b\.html -> \/a\.html/);
  assert.match(result[0]!.fix.summary, /point \/a\.html and \/b\.html/);
});

test("html.redirect-chain reports a loop found through a lead-in page once, on the loop itself", async () => {
  const [only] = await findings({
    "a.html": PAGE(REFRESH(1, "/b.html")),
    "b.html": PAGE(REFRESH(2, "/c.html")),
    "c.html": PAGE(REFRESH(3, "/b.html")),
  });
  assert.ok(only);
  assert.equal(only.location.file, "b.html");
  assert.equal(only.severity, "error");
  assert.match(only.message, /\/b\.html -> \/c\.html -> \/b\.html/);
});

test("html.redirect-chain reports a page whose refresh points at itself", async () => {
  const [only] = await findings({ "a.html": PAGE(REFRESH(3, "/a.html")) });
  assert.ok(only);
  assert.equal(only.location.file, "a.html");
  assert.equal(only.severity, "error");
  assert.match(only.message, /redirects to itself: \/a\.html -> \/a\.html/);
  assert.match(only.fix.summary, /Point it at the destination readers should reach/);
});

test("html.redirect-chain stops when the chain leaves the site or runs into a missing page", async () => {
  const result = await findings({
    "a.html": PAGE(REFRESH(1, "/b.html")),
    "b.html": PAGE(REFRESH(2, "/missing.html")),
    "out.html": PAGE(REFRESH(1, "/a.html")),
    "c.html": PAGE(REFRESH(2, "https://example.com/")),
    "d.html": PAGE(REFRESH(1, "/e.html")),
    "e.html": PAGE(CONTENT),
  });
  assert.deepEqual(result, []);
});

test("html.redirect-chain keeps its fingerprint when a delay changes or unrelated content moves", async () => {
  const site = { "a.html": PAGE(REFRESH(5, "/b.html")), "b.html": PAGE(REFRESH(0, "/c.html")), "c.html": PAGE("") };
  const [before] = await findings(site);
  const [after] = await findings({
    "a.html": PAGE(`<p>more</p>${REFRESH(7, "/b.html")}`),
    "b.html": PAGE(REFRESH(0, "/c.html")),
    "c.html": PAGE(""),
  });
  assert.equal(before!.fingerprint, after!.fingerprint);
});
