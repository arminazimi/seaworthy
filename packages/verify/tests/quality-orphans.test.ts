// quality.orphans: which pages of the built site nothing links to, and which pages are exempt.

import assert from "node:assert/strict";
import { test } from "node:test";

import { runChecks } from "../src/engine.js";
import { qualityOrphans } from "../src/checks/quality.js";
import { buildSite } from "../src/site.js";
import type { Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

async function findings(files: Record<string, string>): Promise<Finding[]> {
  const site = buildSite(makeSite(files));
  const result = await runChecks({ site, checks: [qualityOrphans], enable: { network: false }, options: { "quality.orphans": {} } });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("quality.orphans reports an unlinked page once, with a manual fix naming it", async () => {
  const [f] = await findings({
    "index.html": PAGE('<a href="/about.html">about</a>'),
    "about.html": PAGE('<a href="/">home</a>'),
    "draft.html": PAGE("<p>nobody points here</p>"),
  });
  assert.equal(f!.checkId, "quality.orphans");
  assert.equal(f!.severity, "warning");
  assert.equal(f!.location.file, "draft.html");
  assert.equal(f!.fingerprint.length, 16);
  assert.match(f!.message, /No other page links to \/draft\.html/);
  assert.equal(f!.fix.kind, "manual");
  assert.deepEqual(f!.fix.edits, []);
  assert.match(f!.fix.summary, /Add a link to \/draft\.html|delete the page/);
});

test("quality.orphans reports nothing for linked, index, 404, and sitemap-listed pages", async () => {
  const out = await findings({
    "index.html": PAGE('<a href="/about.html">about</a>'),
    "about.html": PAGE('<a href="/">home</a>'),
    "secret.html": PAGE("only the sitemap knows me"),
    "404.html": PAGE("not found"),
    "blog/index.html": PAGE("a directory index"),
    "sitemap.xml": '<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.test/secret.html</loc></url>\n</urlset>\n',
  });
  assert.deepEqual(out, []);
});

test("quality.orphans follows a sitemap index to the sitemaps it lists", async () => {
  const out = await findings({
    "index.html": PAGE(""),
    "archived.html": PAGE("published, but not linked"),
    "sitemap.xml": '<?xml version="1.0" encoding="utf-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.test/sitemap-pages.xml</loc></url>\n</sitemapindex>\n',
    "sitemap-pages.xml": '<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.test/archived.html</loc></url>\n</urlset>\n',
  });
  assert.deepEqual(out, []);
});

test("quality.orphans: self-links and fragments do not make a page reachable", async () => {
  const out = await findings({
    "index.html": PAGE(""),
    "ego.html": PAGE('<a href="#top">top</a> <a href="ego.html#top">self</a> <a href="/ego.html">self again</a>'),
  });
  assert.deepEqual(out.map((f) => f.location.file), ["ego.html"]);
});

test("quality.orphans counts relative, extensionless, and directory links, and links from orphan pages", async () => {
  const out = await findings({
    "index.html": PAGE('<a href="guide">guide</a>'),
    "guide.html": PAGE('<a href="./tips.html">tips</a>'),
    "sofa.html": PAGE('<a href="/changelog.html">changelog</a>'),
    "tips.html": PAGE("<p>t</p>"),
    "changelog.html": PAGE("<p>c</p>"),
  });
  assert.deepEqual(out.map((f) => f.location.file), ["sofa.html"], "guide.html and tips.html are linked; sofa.html links to changelog.html only");
});

test("quality.orphans honors the base path when resolving links", async () => {
  const site = buildSite(makeSite({ "index.html": PAGE('<a href="/repo/about.html">a</a>'), "about.html": PAGE(""), "draft.html": PAGE("") }), { basePath: "/repo/" });
  const result = await runChecks({ site, checks: [qualityOrphans], enable: { network: false }, options: {} });
  assert.deepEqual(result.findings.map((f) => f.location.file), ["draft.html"]);
});
