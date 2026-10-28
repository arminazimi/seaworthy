import assert from "node:assert/strict";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { assetsMissing, srcsetUrls } from "../src/checks/assets.js";
import { externalLinksCheck, probe } from "../src/checks/external.js";
import { linksBaseUrl, linksInternal } from "../src/checks/links.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { runChecks } from "../src/engine.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

async function findings(check: Check, files: Record<string, string>, opts: { basePath?: string; options?: Record<string, unknown>; network?: boolean } = {}): Promise<Finding[]> {
  const site = buildSite(makeSite(files), opts.basePath === undefined ? {} : { basePath: opts.basePath });
  const result = await runChecks({ site, checks: [check], enable: { network: opts.network ?? false }, options: { [check.meta.id]: opts.options ?? {} } });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("links.internal proposes an exact edit for a typo, in the style of the original link", async () => {
  const [absolute, relative] = await findings(linksInternal, {
    "index.html": PAGE('<a href="/docs/guid.html?x=1#a">abs</a>\n<a href="docs/guid.html">rel</a>'),
    "docs/guide.html": PAGE('<h2 id="a">a</h2>'),
  });
  assert.equal(absolute!.fix.kind, "edit");
  assert.deepEqual(absolute!.fix.edits, [{ file: "index.html", line: 5, action: "replace", find: 'href="/docs/guid.html?x=1#a"', replace: 'href="/docs/guide.html?x=1#a"' }]);
  assert.deepEqual(relative!.fix.edits, [{ file: "index.html", line: 6, action: "replace", find: 'href="docs/guid.html"', replace: 'href="docs/guide.html"' }]);
  assert.match(absolute!.fix.summary, /closest match: \/docs\/guide\.html/);
});

test("links.internal says so instead of guessing when nothing is close", async () => {
  const [f] = await findings(linksInternal, { "index.html": PAGE('<a href="/completely/elsewhere.html">x</a>'), "a.html": PAGE("") });
  assert.equal(f!.fix.kind, "manual");
  assert.deepEqual(f!.fix.edits, []);
});

test("links.internal suggests the closest heading id for a broken anchor", async () => {
  const [f] = await findings(linksInternal, { "index.html": PAGE('<a href="/g.html#instal">x</a>'), "g.html": PAGE('<h2 id="install">i</h2><h2 id="usage">u</h2>') });
  assert.match(f!.message, /points to #instal, but \/g\.html has no element with that id/);
  assert.deepEqual(f!.fix.edits.map((e) => [e.find, e.replace]), [['href="/g.html#instal"', 'href="/g.html#install"']]);
});

test("links.internal honors the base path when resolving", async () => {
  const files = { "index.html": PAGE('<a href="/repo/about.html">a</a> <a href="/repo/nope.html">n</a>'), "about.html": PAGE("") };
  assert.deepEqual((await findings(linksInternal, files, { basePath: "/repo/" })).map((f) => f.message.slice(0, 28)), ["Link to /repo/nope.html poin"]);
  assert.equal((await findings(linksInternal, files)).length, 2, "without a base path both /repo/ links are broken");
  assert.deepEqual((await findings(linksInternal, files, { basePath: "repo" })).length, 1, "the base path is normalized");
});

test("links.internal ignores external, mailto, and non-link elements", async () => {
  const out = await findings(linksInternal, { "index.html": PAGE('<a href="https://x.test/a">e</a> <a href="mailto:a@b.test">m</a> <a href="tel:1">t</a> <a>no href</a> <link rel="stylesheet" href="/nope.css">') });
  assert.deepEqual(out, []);
});

test("assets.missing reads srcset, link rels, input images, and ignores data URIs and remote files", async () => {
  const out = await findings(assetsMissing, {
    "index.html": PAGE(
      [
        '<img srcset="a.png 1x, b.png 2x, data:image/gif;base64,AAAA 3x">',
        '<link rel="stylesheet" href="s.css"> <link rel="preload" as="font" href="f.woff2"> <link rel="canonical" href="/nope"> <link rel="alternate" href="/feed.xml">',
        '<input type="image" src="btn.png"> <input type="text" src="ignored.png">',
        '<img src="https://cdn.test/x.png"> <img src="">',
      ].join("\n"),
    ),
    "a.png": "x",
  });
  assert.deepEqual(out.map((f) => f.message.match(/loads (\S+),/)![1]), ["b.png", "s.css", "f.woff2", "btn.png"]);
});

test("assets.missing suggests the closest file with the same extension, in the style of the original", async () => {
  const [f] = await findings(assetsMissing, { "index.html": PAGE('<img src="/img/logo.pn" alt="">'), "img/logo.png": "x", "img/logo.css": "x" });
  assert.deepEqual(f!.fix.edits.map((e) => [e.find, e.replace]), [['src="/img/logo.pn"', 'src="/img/logo.png"']]);
});

test("links.base-url: one broken link is not enough to guess a base path", async () => {
  const out = await findings(linksBaseUrl, { "index.html": PAGE('<a href="/repo/a.html">a</a> <a href="/a.html">ok</a>'), "a.html": PAGE("") });
  assert.deepEqual(out, []);
});

test("links.base-url: links that already break for other reasons are not mistaken for a prefix", async () => {
  const out = await findings(linksBaseUrl, { "index.html": PAGE('<a href="/old/a.html">a</a> <a href="/old/b.html">b</a> <a href="/old/c.html">c</a>'), "z.html": PAGE("") });
  assert.deepEqual(out, [], "removing /old/ does not make them resolve");
});

test("links.base-url under a configured base path gives the exact fix", async () => {
  const out = await findings(linksBaseUrl, { "index.html": PAGE('<a href="/about.html">a</a> <a href="/repo/about.html">b</a> <a href="/repo">root</a> <a href="https://x.test/y">c</a>'), "about.html": PAGE("") }, { basePath: "/repo/" });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.fix.edits.map((e) => [e.find, e.replace]), [['href="/about.html"', 'href="/repo/about.html"']]);
});

// ---- links.external, against a real HTTP server on loopback -------------------------------------------------

let server: Server;
let base = "";
const hits: string[] = [];
before(async () => {
  server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const url = req.url ?? "/";
    if (url === "/ok") return void res.writeHead(200).end("ok");
    if (url === "/gone") return void res.writeHead(404).end();
    if (url === "/removed") return void res.writeHead(410).end();
    if (url === "/boom") return void res.writeHead(503).end();
    if (url === "/head-refused") return void res.writeHead(req.method === "HEAD" ? 405 : 200).end();
    if (url === "/head-lies") return void res.writeHead(req.method === "HEAD" ? 404 : 200).end();
    if (url === "/moved") return void res.writeHead(301, { location: "/ok" }).end();
    if (url === "/forbidden") return void res.writeHead(403).end();
    if (url === "/ratelimited") return void res.writeHead(429).end();
    if (url === "/botwall") return void res.writeHead(403, { "cf-mitigated": "challenge" }).end();
    if (url === "/slow") return; // never answers
    res.writeHead(404).end();
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const linkTo = (path: string) => `<a href="${base}${path}">${path}</a>`;

test("probe: classifies statuses the way the docs promise", async () => {
  // Generous timeout: the first loopback connection on a cold Windows runner can take over a second.
  const kind = async (path: string) => (await probe(`${base}${path}`, fetch, 10_000)).kind;
  assert.equal(await kind("/ok"), "ok");
  assert.equal(await kind("/moved"), "ok", "redirects are followed");
  assert.equal(await kind("/head-refused"), "ok", "a server that refuses HEAD gets a GET");
  assert.equal(await kind("/head-lies"), "ok", "a server that 404s HEAD but serves GET is fine");
  assert.equal(await kind("/gone"), "broken");
  assert.equal(await kind("/removed"), "broken");
  assert.equal(await kind("/boom"), "server-error");
  for (const undecided of ["/forbidden", "/ratelimited", "/botwall"]) assert.equal(await kind(undecided), "skipped", undecided);
});

test("probe: an unreachable host and a silent server are reported, not thrown", async () => {
  const slow = await probe(`${base}/slow`, fetch, 150);
  assert.deepEqual(slow, { kind: "unreachable", reason: "no answer within 0.15 seconds" });
  const refused = await probe("http://127.0.0.1:1/", fetch, 10_000);
  assert.equal(refused.kind, "unreachable");
});

test("links.external is skipped unless the network is enabled", async () => {
  const site = buildSite(makeSite({ "index.html": PAGE(linkTo("/gone")) }));
  const before = hits.length;
  const result = await runChecks({ site, checks: [externalLinksCheck()] });
  assert.equal(hits.length, before, "no request was made");
  assert.deepEqual(result.skipped.map((s) => [s.check, s.reason]), [["links.external", "network-checks-disabled"]]);
});

test("links.external reports broken links with the right severity, once per occurrence, and fetches each URL once", async () => {
  hits.length = 0;
  const out = await findings(
    externalLinksCheck(),
    { "index.html": PAGE([linkTo("/ok"), linkTo("/gone"), linkTo("/boom"), linkTo("/forbidden"), linkTo("/botwall")].join("\n")), "b.html": PAGE(linkTo("/gone")) },
    { network: true },
  );
  assert.deepEqual(out.map((f) => [f.location.file, f.severity, f.message.replace(base, "")]), [
    ["index.html", "error", "/gone responds with 404."],
    ["index.html", "warning", "/boom responds with 503, a server error that may be temporary."],
    ["b.html", "error", "/gone responds with 404."],
  ].sort() as never);
  assert.equal(hits.filter((h) => h === "HEAD /gone").length, 1, "the same URL on two pages is fetched once");
});

test("links.external honors ignore patterns and reports unreachable servers as warnings", async () => {
  const out = await findings(
    externalLinksCheck(),
    { "index.html": PAGE(`${linkTo("/gone")} <a href="http://127.0.0.1:1/x">dead</a>`) },
    { network: true, options: { ignore: ["/gone$"], timeoutMs: 500 } },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.severity, "warning");
  assert.match(out[0]!.message, /could not be reached/);
});

/**
 * A fetch that holds every caller until `expected` calls are in flight, so the asserted
 * concurrency is reached by construction, not by racing fixed sleeps. The fallback releases
 * a broken pool after five seconds, which fails `reached()` instead of hanging the test.
 */
function gatedFetch(expected: number): { fetchImpl: typeof fetch; peak: () => number; reached: () => boolean } {
  let active = 0;
  let peak = 0;
  let reached = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fallback = setTimeout(() => release(), 5_000);
  const fetchImpl = (async () => {
    active++;
    peak = Math.max(peak, active);
    if (active >= expected && !reached) {
      reached = true;
      clearTimeout(fallback);
      release();
    }
    await gate;
    active--;
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, peak: () => peak, reached: () => reached };
}

test("links.external respects the per-host limit", async () => {
  const sameHost = gatedFetch(2);
  const links = Array.from({ length: 12 }, (_, i) => `<a href="http://one.test/${i}">${i}</a>`).join("\n");
  await findings(externalLinksCheck(sameHost.fetchImpl), { "index.html": PAGE(links) }, { network: true });
  assert.equal(sameHost.peak(), 2, "the two per-host slots are used, never more");
  assert.ok(sameHost.reached(), "the gate saw two requests in flight");

  const wide = gatedFetch(5);
  const hosts = Array.from({ length: 20 }, (_, i) => `<a href="http://h${i}.test/">${i}</a>`).join("\n");
  await findings(externalLinksCheck(wide.fetchImpl), { "index.html": PAGE(hosts) }, { network: true, options: { concurrency: 5 } });
  assert.equal(wide.peak(), 5, "the overall limit of five is reached, never exceeded");
  assert.ok(wide.reached(), "the gate saw five requests in flight");
});

test("srcsetUrls follows the HTML parsing rules", () => {
  assert.deepEqual(srcsetUrls("a.png 1x, b.png 2x"), ["a.png", "b.png"]);
  assert.deepEqual(srcsetUrls("a.png, b.png"), ["a.png", "b.png"], "no descriptors");
  assert.deepEqual(srcsetUrls("a.png,b.png 2x"), ["a.png,b.png"], "a comma inside a token belongs to the URL, as the HTML spec says");
  assert.deepEqual(srcsetUrls("a.png,b.png,"), ["a.png,b.png"], "only trailing commas separate");
  assert.deepEqual(srcsetUrls("  a.png   480w ,\n  b.png\t960w  "), ["a.png", "b.png"], "any whitespace");
  assert.deepEqual(srcsetUrls("data:image/gif;base64,AAAA 1x, b.png 2x"), ["data:image/gif;base64,AAAA", "b.png"], "a data URI keeps its comma");
  assert.deepEqual(srcsetUrls("a.png (min-width: 1px, max-width: 2px) 1x, b.png 2x"), ["a.png", "b.png"], "commas inside parentheses stay in the descriptor");
  assert.deepEqual(srcsetUrls(""), []);
  assert.deepEqual(srcsetUrls(" , , "), []);
});

test("attribute edits keep the quote style, escape what needs escaping, and decline multi-line values", async () => {
  const [single, ampersand] = await findings(linksInternal, { "index.html": PAGE(`<a href='/docs/guid.html'>a</a>\n<a href="/docs/guid.html?a=1&amp;b=2">b</a>`), "docs/guide.html": PAGE("") });
  assert.deepEqual(single!.fix.edits.map((e) => [e.find, e.replace]), [[`href='/docs/guid.html'`, `href='/docs/guide.html'`]]);
  assert.deepEqual(ampersand!.fix.edits.map((e) => [e.find, e.replace]), [['href="/docs/guid.html?a=1&amp;b=2"', 'href="/docs/guide.html?a=1&amp;b=2"']], "the decoded & is written back as &amp;");
});
