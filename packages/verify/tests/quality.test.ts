import assert from "node:assert/strict";
import { test } from "node:test";

import { qualityEmptyPages } from "../src/checks/quality.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const REDIRECT = '<meta http-equiv="refresh" content="0; url=/other.html">';
// Lines: 1 doctype, 2 html, 3-6 head, 7 body, 8 header/nav, 9 first content line, 10 footer.
const page = (body: string, head = "<title>t</title>") =>
  `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  ${head}\n</head>\n<body>\n<header><nav><a href="/">Home</a> <a href="/about.html">About</a></nav></header>\n${body}\n<footer><p>© Example Company</p></footer>\n</body>\n</html>\n`;
const CONTENT = '<main><h1>Real page</h1><p>Sentences that carry the page\u2019s meaning and arrive in the HTML itself.</p></main>';

async function run(files: Record<string, string>) {
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": page(CONTENT), ...files })), checks: [qualityEmptyPages] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("quality.empty-pages: a real page and a tiny legal page pass", async () => {
  const legal = page('<main><h1>Privacy</h1><p>We collect nothing. We never share anything with anyone.</p></main>');
  assert.deepEqual(await run({ "legal.html": legal }), []);
});

test("quality.empty-pages: reports an empty main and points at its tag", async () => {
  const [finding] = await run({ "empty.html": page("<main></main>") });
  assert.deepEqual([finding!.location.file, finding!.location.line, finding!.location.column], ["empty.html", 9, 1]);
  assert.match(finding!.message, /<main> has no text/);
  assert.equal(finding!.severity, "warning");
  assert.match(finding!.fix.summary, /Serve the page's real content inside <main>/);
});

test("quality.empty-pages: reports a page of nothing but chrome when there is no main", async () => {
  const [finding] = await run({ "chrome.html": page('<div class="wrap"></div>') });
  assert.equal(finding!.location.file, "chrome.html");
  assert.match(finding!.message, /no <main> and, apart from its navigation, header, and footer, no text at all/);
  assert.match(finding!.fix.summary, /Add a <main>/);
});

test("quality.empty-pages: role=main holds the content, and an empty one is reported", async () => {
  assert.deepEqual(await run({ "r.html": page('<div role="main"><h1>Products</h1><p>A price list an agent can quote.</p></div>') }), []);
  const [finding] = await run({ "e.html": page('<div role="main"></div>') });
  assert.equal(finding!.location.file, "e.html");
  assert.match(finding!.message, /<main> has no text/);
});

test("quality.empty-pages: chrome by role and by element is not main text", async () => {
  const roles = page('<div role="navigation" aria-label="Sections"><a href="/a.html">Products and services</a> <a href="/b.html">Support and repairs</a></div>');
  assert.deepEqual(await run({ "r.html": roles }).then((f) => f.map((x) => x.location.file)), ["r.html"]);
  const regionRole = page('<div role="region"><p>Words that belong to this page alone are fine.</p></div>');
  assert.deepEqual(await run({ "k.html": regionRole }), []);
});

test("quality.empty-pages: hidden content and empty inline elements are not wording", async () => {
  const ariaHidden = page('<main><div aria-hidden="true">Enough words to pass any threshold that counted hidden text.</div></main>');
  assert.equal((await run({ "h.html": ariaHidden })).length, 1);
  const elementsWithHidden = page('<main><div hidden>Enough words to pass any threshold that counted hidden text.</div></main>');
  assert.equal((await run({ "i.html": elementsWithHidden })).length, 1);
});

test("quality.empty-pages: media shows a reader something, so an image or canvas page passes", async () => {
  const image = page('<main><img src="/logo.png" alt="" width="64" height="64"></main>');
  const canvas = page('<main><canvas id="map"></canvas></main>');
  const embed = page('<main><iframe src="https://maps.example.test/hq" title="Headquarters"></iframe></main>');
  const alt = page('<main><img src="/logo.png" alt="Roadmap diagram, revenue rising" width="64" height="64"></main>');
  assert.deepEqual(await run({ "a.html": image, "b.html": canvas, "c.html": embed, "d.html": alt }), []);
});

test("quality.empty-pages: a redirect page and a client-rendered shell pass", async () => {
  const redirect = page("<main></main>", REDIRECT);
  const shell = page('<div id="root"></div>\n<script type="module" src="/app.js"></script>');
  assert.deepEqual(await run({ "d.html": redirect, "s.html": shell }), []);
});

test("quality.empty-pages: wordy scripts do not rescue an empty page", async () => {
  const noise = page('<main></main>\n<script>console.log("plenty of words inside this script that should never count as content");</script>');
  const findings = await run({ "n.html": noise });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.location.file, "n.html");
});

test("quality.empty-pages: every empty page is reported once, in file order", async () => {
  const findings = await run({ "z.html": page("<main></main>"), "a.html": page('<div class="wrap"></div>') });
  assert.deepEqual(findings.map((f) => f.location.file), ["a.html", "z.html"]);
});
