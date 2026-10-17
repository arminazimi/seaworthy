import assert from "node:assert/strict";
import { test } from "node:test";

import { securityMixedContent, securityTargetBlank } from "../src/checks/security.js";
import { robotsBlocksAll, robotsSitemap, sitemapEntries } from "../src/checks/sitemap.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = (body = "") => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;
const SITEMAP = (...locs: string[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.map((l) => `  <url><loc>${l}</loc></url>`).join("\n")}\n</urlset>\n`;

async function run(check: Check, files: Record<string, string>, basePath?: string): Promise<Finding[]> {
  const site = buildSite(makeSite(files), basePath === undefined ? {} : { basePath });
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("sitemap.entries: no sitemap, no findings", async () => {
  assert.deepEqual(await run(sitemapEntries, { "index.html": PAGE() }), []);
});

test("sitemap.entries reports a file that is not a sitemap", async () => {
  const [f] = await run(sitemapEntries, { "index.html": PAGE(), "sitemap.xml": "<html>oops</html>" });
  assert.match(f!.message, /is not a sitemap/);
});

test("sitemap.entries honors the base path and decodes XML entities", async () => {
  const files = { "index.html": PAGE(), "docs/a.html": PAGE(), "sitemap.xml": SITEMAP("https://user.github.io/repo/", "https://user.github.io/repo/docs/a.html", "https://user.github.io/repo/docs/a.html?x=1&amp;y=2") };
  assert.deepEqual(await run(sitemapEntries, files, "/repo/"), []);
  assert.equal((await run(sitemapEntries, files)).length, 3, "without the base path, none of the /repo/ URLs is served");
});

test("sitemap.entries does not loop on a sitemap index that lists itself", async () => {
  const index = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://x.test/sitemap.xml</loc></sitemap></sitemapindex>`;
  assert.deepEqual(await run(sitemapEntries, { "index.html": PAGE(), "sitemap.xml": index }), []);
});

test("robots.blocks-all reads groups the way RFC 9309 does", async () => {
  const blocked = async (robots: string) => (await run(robotsBlocksAll, { "index.html": PAGE(), "robots.txt": robots })).length;
  assert.equal(await blocked("User-agent: *\nDisallow: /\n"), 1);
  assert.equal(await blocked("user-agent: *   # everyone\ndisallow: /   # everything\n"), 1, "case-insensitive fields, comments ignored");
  assert.equal(await blocked("User-agent: bot-a\nUser-agent: *\nDisallow: /\n"), 1, "several user agents share one group");
  assert.equal(await blocked("User-agent: *\nDisallow: /\nAllow: /docs/\n"), 0, "an Allow rule means not everything is blocked");
  assert.equal(await blocked("User-agent: *\nDisallow: /private/\n"), 0);
  assert.equal(await blocked("User-agent: Googlebot\nDisallow: /\n"), 0, "one crawler only");
  assert.equal(await blocked("User-agent: *\nDisallow:\n"), 0, "an empty Disallow allows everything");
  assert.equal(await blocked("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /\n"), 0);
});

test("robots.sitemap checks every Sitemap line", async () => {
  const found = await run(robotsSitemap, { "index.html": PAGE(), "sitemap.xml": SITEMAP("https://x.test/"), "robots.txt": "sitemap: https://x.test/sitemap.xml\nSitemap:\nSITEMAP: sitemap.xml\nSitemap: https://x.test/other.xml\n" });
  assert.deepEqual(found.map((f) => f.location.line), [2, 3, 4]);
  assert.match(found[0]!.message, /has no URL/);
  assert.match(found[1]!.message, /not an absolute URL/);
  assert.match(found[2]!.message, /not in the built site/);
});

test("security.target-blank: exact edits for missing and incomplete rel", async () => {
  const found = await run(securityTargetBlank, { "index.html": PAGE('<a href="https://x.test/a" target="_blank">a</a>\n<a href="//x.test/b" target="_blank" rel="nofollow">b</a>\n<a href="https://x.test/c" target="_blank" rel="noreferrer">c</a>\n<a href="/d" target="_blank">d</a>') });
  assert.deepEqual(found.map((f) => [f.fix.edits[0]!.find, f.fix.edits[0]!.replace]), [
    ['href="https://x.test/a"', 'href="https://x.test/a" rel="noopener noreferrer"'],
    ['rel="nofollow"', 'rel="nofollow noopener noreferrer"'],
  ]);
  assert.equal(found[0]!.severity, "note");
});

test("security.mixed-content suggests the https address and skips what is not mixed content", async () => {
  const found = await run(securityMixedContent, {
    "index.html": PAGE(['<img src="http://cdn.test/a.png" alt="">', '<a href="http://x.test/">navigation</a>', '<img src="http://127.0.0.1:8080/a.png" alt="">', '<img src="https://cdn.test/ok.png" alt="">', '<link rel="canonical" href="http://x.test/">', '<iframe src="HTTP://embed.test/x"></iframe>'].join("\n")),
  });
  assert.deepEqual(found.map((f) => [f.fix.edits[0]!.find, f.fix.edits[0]!.replace]), [
    ['src="http://cdn.test/a.png"', 'src="https://cdn.test/a.png"'],
    ['src="HTTP://embed.test/x"', 'src="https://embed.test/x"'],
  ]);
});
