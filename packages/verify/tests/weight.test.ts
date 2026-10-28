import assert from "node:assert/strict";
import { test } from "node:test";

import { qualityPageWeight } from "../src/checks/quality.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const page = (body: string) =>
  `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>t</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

type Budgets = Record<string, number>;

async function run(files: Record<string, string | Buffer>, budgets: Budgets) {
  const result = await runChecks({
    site: buildSite(makeSite({ "index.html": page("<main><p>Hello</p></main>"), ...files })),
    checks: [qualityPageWeight],
    options: { "quality.page-weight": { budgets } },
  });
  assert.deepEqual(result.errors, []);
  return result.findings;
}
const ONE = { "other.html": page("<main><p>plenty of page text</p>") };

test("quality.page-weight: with no budgets the check is off and reports nothing", async () => {
  const heavy = { "browser.html": page('<main><script>' + "x".repeat(500) + "</script></main>") };
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": page("<main><p>Hi</p></main>"), ...heavy })), checks: [qualityPageWeight] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings, []);
});

test("quality.page-weight: a page under every budget is silent", async () => {
  assert.deepEqual(await run(ONE, { html: 50000, css: 1000, javascript: 1000, images: 1000, fonts: 1000 }), []);
});

test("quality.page-weight: one finding per over-budget bucket, not per asset", async () => {
  const findings = await run(
    {
      ...ONE,
      "css.html": page('<main><p>styled words for a reader</p></main><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css">'),
      "a.css": "p{margin:6mm}\n".repeat(40),
      "b.css": "p{color:#123}\n".repeat(40),
    },
    { css: 100 },
  );
  assert.equal(findings.length, 1, "two stylesheets over budget yield one finding for the css bucket");
  assert.equal(findings[0]!.location.file, "css.html", "the finding is named where the page loads its heaviest stylesheet");
  assert.match(findings[0]!.message, /loads \d+ KB of CSS.*over .*budget; its heaviest asset is \/a\.css/);
  assert.deepEqual(findings[0]!.fix, {
    appliesTo: "built-output",
    kind: "manual",
    summary: "Compress or inline only the CSS the page needs: minify it, remove rules the page does not use, or split off deferred styles.",
    edits: [],
  });
});

test("quality.page-weight: a file that two elements load counts once per page", async () => {
  const twice = '<img src="/logo.png" alt="a" width="4" height="4"><img src="/logo.png" alt="b" width="4" height="4">';
  const findings = await run({ "logo.html": page(`<main><p>words for the reader</p>${twice}</main>`), "logo.png": Buffer.alloc(600, 7) }, { images: 100 });
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /heaviest asset is \/logo\.png/);
});

test("quality.page-weight: external URLs are not this build's weight; data URIs are", async () => {
  const body = `<main><p>reading matter</p><img src="https://cdn.example.test/logo.png" alt="" width="4" height="4"><img src="data:image/png;base64,${"A".repeat(200)}" alt="" width="4" height="4"></main>`;
  const findings = await run({ "d.html": page(body) }, { images: 100 });
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /a data URI/);
});

test("quality.page-weight: scripts count src files and inline bodies, not non-executed types", async () => {
  const body = '<main><p>the text of this page</p><script src="/app.js"></script><script>' + "q".repeat(300) + "</script>" + '<script type="application/json">{"loads":0}</script></main>';
  const findings = await run({ "js.html": page(body), "app.js": "//".padEnd(120, "=") }, { javascript: 100 });
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /of JavaScript/);
});

test("quality.page-weight: fonts come from @font-face lines in linked stylesheets", async () => {
  const css = '@font-face{font-family:A;src:url(/f/a.woff2) format("woff2")}\n@font-face{font-family:B;src:url(/f/a.woff2) format("woff2")}\n.a{background-image:url(/img/x.png)}\n';
  const findings = await run({ "f.html": page('<main><p>letter forms</p></main><link rel="stylesheet" href="/k.css">'), "k.css": css, "f/a.woff2": Buffer.alloc(400, 1), "img/x.png": Buffer.alloc(400, 1) }, { fonts: 100, images: 1_000_000 });
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /of fonts.*heaviest asset is \/f\/a\.woff2/, "the duplicate face counts once and the non-font url does not count");
});

test("quality.page-weight: an unservable or malformed budget falls back to the defaults", async () => {
  const body = `<main><script src="/m.js"></script><p>Other text lives here.</p></main>`;
  const findings = await run({ "m.html": page(body), "m.js": "//".padEnd(500, "=") }, { javascript: -1, html: Number.NaN, css: "5" as unknown as number });
  assert.deepEqual(findings, [], "the defaults (200 000 JavaScript, 50 000 HTML) keep a tiny page silent");
});
