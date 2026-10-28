import assert from "node:assert/strict";
import { test } from "node:test";

import { hostingHeaders, hostingRedirects } from "../src/checks/hosting.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = (body = "") => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;

async function run(check: Check, files: Record<string, string>, basePath?: string): Promise<Finding[]> {
  const site = buildSite(makeSite(files), basePath === undefined ? {} : { basePath });
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("hosting.headers: no file, no findings", async () => {
  assert.deepEqual(await run(hostingHeaders, { "index.html": PAGE() }), []);
});

test("hosting.headers: valid blocks, indented the way Cloudflare and Netlify write them", async () => {
  const headers = [
    "# headers for every response",
    "/*",
    "  X-Frame-Options: DENY",
    "",
    "/about.html",
    "X-Frame-Options: SAMEORIGIN",
    '"/contact page.html"',
    '  Link: </index.html>; rel="canonical"',
    "",
  ].join("\n");
  assert.deepEqual(await run(hostingHeaders, { "index.html": PAGE(), "about.html": PAGE(), "contact page.html": PAGE(), "_headers": headers }), []);
});

test("hosting.headers: a path with no file in the build is reported", async () => {
  const [f] = await run(hostingHeaders, { "index.html": PAGE(), "_headers": "/about\n  Cache-Control: no-store\n" });
  assert.match(f!.message, /"\/about" matches nothing/);
  assert.equal(f!.location.line, 1);
  assert.equal(f!.location.column, 1);
});

test("hosting.headers: a path with a splat or placeholder is not checked against the build", async () => {
  const headers = "/*\n/blog/:year\n  Cache-Control: no-store\n";
  assert.deepEqual(await run(hostingHeaders, { "index.html": PAGE(), "_headers": headers }), []);
});

test("hosting.headers: malformed lines with exact positions", async () => {
  const found = await run(hostingHeaders, {
    "index.html": PAGE(),
    "_headers": "/*\n  X-Frame-Options: DENY\n\nNo Colon Here\n/templates/broken:wrong\nX Frame Options: DENY\n",
  });
  assert.deepEqual(found.map((f) => [f.location.line, f.location.column]), [[4, 1], [5, 1], [6, 1]]);
  assert.match(found[0]!.message, /not a URL path and not a header/);
  assert.match(found[1]!.message, /placeholder after text/);
  assert.match(found[2]!.message, /not a valid HTTP header field name/);
});

test("hosting.headers: paths the hosts cannot match are reported", async () => {
  const found = await run(hostingHeaders, {
    "index.html": PAGE(),
    "_headers": "/*\n  Link: </index.html>; rel=\"canonical\"\n\n/docs/:placeholder*\n  Cache-Control: no-store\n\n/templates/*:year\n  Cache-Control: no-store\n",
  });
  assert.deepEqual(found.map((f) => f.location.line), [4, 7]);
  assert.match(found[0]!.message, /splat and a placeholder in the same path segment/);
  assert.match(found[1]!.message, /splat and a placeholder in the same path segment/);
});

test("hosting.headers: a field name with no valid header characters is reported", async () => {
  const [f] = await run(hostingHeaders, { "index.html": PAGE(), "_headers": "/*\nX Frame Options: DENY\n" });
  assert.match(f!.message, /not a valid HTTP header field name/);
  assert.equal(f!.location.line, 2);
});

test("hosting.headers: honors the base path when the site is served under one", async () => {
  const files = { "index.html": PAGE(), "contact.html": PAGE(), "_headers": "/repo/contact\n  Cache-Control: no-store\n" };
  assert.deepEqual(await run(hostingHeaders, files, "/repo/"), []);
  assert.equal((await run(hostingHeaders, files)).length, 1);
});

test("hosting.redirects: no file, no findings", async () => {
  assert.deepEqual(await run(hostingRedirects, { "index.html": PAGE() }), []);
});

test("hosting.redirects: rules the hosts document pass", async () => {
  const redirects = [
    "# from old addresses",
    "/home /",
    "/blog/my-post.php /blog/my-post 301",
    "/cuties https://www.example.test",
    "/* /index.html 200!",
    "/en/* /en/404.html 404",
    "/gone 410",
    "/news/:month/:post /blog/:month/:post",
    "/ /anz 302 Country=au",
    '"/two words" /one 301',
    "/search id=:id tag=:tag /posts/:tag/:id 301",
  ].join("\n");
  const files = { "index.html": PAGE(), "blog/my-post.html": PAGE(), "en/404.html": PAGE(), "anz.html": PAGE(), "one.html": PAGE(), "_redirects": redirects };
  assert.deepEqual(await run(hostingRedirects, files), []);
});

test("hosting.redirects: a destination the build does not serve is reported", async () => {
  const [f] = await run(hostingRedirects, { "index.html": PAGE(), "_redirects": "/old-blog /blog/missing 301\n" });
  assert.match(f!.message, /\/blog\/missing points at a file the built site does not have/);
  assert.equal(f!.severity, "error");
  assert.equal(f!.location.line, 1);
});

test("hosting.redirects: conditions, queries, and external destinations pass the existence check", async () => {
  const redirects = "/shop https://shop.example.test/x\n/old /new?from=shop 200\n/one /place/\n";
  const files = { "index.html": PAGE(), "new.html": PAGE(), "place/index.html": PAGE(), "_redirects": redirects };
  assert.deepEqual(await run(hostingRedirects, files), []);
});

test("hosting.redirects: malformed lines with exact positions", async () => {
  const found = await run(hostingRedirects, {
    "index.html": PAGE(),
    "about.html": PAGE(),
    "_redirects": ["no-slash", "/only-src", "/moved 302", "/written /about 998!", "/plain-word something", "/cut /two /three 301"].join("\n"),
  });
  assert.deepEqual(found.map((f) => f.location.line), [1, 2, 3, 4, 5, 6]);
  assert.match(found[0]!.message, /must start with a source path/);
  assert.match(found[1]!.message, /no destination and no status code/);
  assert.match(found[2]!.message, /has no destination. Only 404 and 410/);
  assert.match(found[3]!.message, /not a status code/);
  assert.match(found[4]!.message, /is not a destination, a status code, or a condition/);
  assert.match(found[5]!.message, /extra word/);
});

test("hosting.redirects: the first match wins, so a repeated rule is dead code", async () => {
  const found = await run(hostingRedirects, { "index.html": PAGE(), "one.html": PAGE(), "two.html": PAGE(), "_redirects": "/dup /one 301\n/dup /two 301\n" });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, "warning");
  assert.equal(found[0]!.location.line, 2);
  assert.match(found[0]!.message, /repeats a rule above/);
});

test("hosting.redirects: the same source with different conditions is not dead code", async () => {
  const redirects = "/products /en-us 301! Language=en-us\n/products /en 301! Language=en\n";
  assert.deepEqual(await run(hostingRedirects, { "index.html": PAGE(), "en-us.html": PAGE(), "en.html": PAGE(), "_redirects": redirects }), []);
});

test("hosting.redirects: a rule that answers its own address loops forever", async () => {
  const [f] = await run(hostingRedirects, { "index.html": PAGE(), "_redirects": "/loop /loop 301\n" });
  assert.equal(f!.location.line, 1);
  assert.match(f!.message, /same address/);
  assert.equal(f!.severity, "error");
});

test("hosting.redirects: a self-rewrite of an existing page is fine; a rewrite to a missing page is not", async () => {
  const files = { "index.html": PAGE(), "about.html": PAGE(), "_redirects": "/about /about 200\n" };
  assert.deepEqual(await run(hostingRedirects, files), []);
  assert.equal((await run(hostingRedirects, { "index.html": PAGE(), "_redirects": "/gone /gone 200\n" })).length, 1);
});

test("hosting.redirects: sources the hosts cannot match are reported", async () => {
  const found = await run(hostingRedirects, { "index.html": PAGE(), "_redirects": "/jobs/*/east /east 301\n/a/:year*/summer /summer/ 301\n" });
  assert.deepEqual(found.map((f) => [f.location.line, f.severity]), [[1, "error"], [2, "error"]]);
  assert.match(found[0]!.message, /splat before the end of the path/);
  assert.match(found[1]!.message, /splat and a placeholder in the same path segment/);
});

test("hosting.redirects: a destination with a splat or placeholders is not checked against the build", async () => {
  const redirects = "/news/* /blog/:splat\n/legacy/:file /serve/:file 200\n";
  assert.deepEqual(await run(hostingRedirects, { "index.html": PAGE(), "_redirects": redirects }), []);
});
