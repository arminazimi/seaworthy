import assert from "node:assert/strict";
import { test } from "node:test";

import { metaCanonicalCycle, metaCanonicalTarget } from "../src/checks/meta.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { runChecks } from "../src/engine.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>t</title>\n${body}</head>\n<body>\n</body>\n</html>\n`;
const CANONICAL = (href: string) => `<link rel="canonical" href="${href}">`;

async function findings(check: Check, files: Record<string, string>, opts: { basePath?: string } = {}): Promise<Finding[]> {
  const site = buildSite(makeSite(files), opts.basePath === undefined ? {} : { basePath: opts.basePath });
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("canonical targets that resolve to pages of the built site are fine", async () => {
  const out = await findings(metaCanonicalTarget, {
    "index.html": PAGE(CANONICAL("https://example.test/")), // the origin-only form, served at /index.html
    "about.html": PAGE(CANONICAL("https://example.test/about.html")), // points at itself
    "docs/guide.html": PAGE(CANONICAL("https://cdn.test/docs/guide")), // extensionless and on another origin, served as /docs/guide.html
  });
  assert.deepEqual(out, []);
});

test("a canonical that points at a page which does not exist is reported, with the resolved path", async () => {
  const out = await findings(metaCanonicalTarget, {
    "index.html": PAGE(CANONICAL("https://example.test/about.htm")),
    "b.html": PAGE(CANONICAL("/nope.html")),
    "about.html": PAGE(""),
  });
  const absolute = out.find((f) => f.location.file === "index.html")!;
  const relative = out.find((f) => f.location.file === "b.html")!;
  assert.match(absolute!.message, /canonical link https:\/\/example\.test\/about\.htm points at \/about\.htm, which is not a page in the built site/);
  assert.equal(absolute!.location.file, "index.html");
  assert.equal(absolute!.location.line, 4);
  assert.equal(absolute!.fix.kind, "manual");
  assert.match(absolute!.fix.summary, /full public URL of the page's content/);
  assert.match(relative!.message, /\/nope\.html, which is not a page/);
});

test("the base path is honored: stripping it finds the page the URL is served from", async () => {
  const files = {
    "index.html": PAGE(CANONICAL("https://example.test/repo/index.html")),
    "about.html": PAGE(CANONICAL("https://example.test/repo/nope.html")),
  };
  const out = await findings(metaCanonicalTarget, files, { basePath: "/repo/" });
  assert.deepEqual(out.map((f) => f.message.match(/points at (\S+),/)![1]), ["/nope.html"]);
  assert.equal((await findings(metaCanonicalTarget, files)).length, 2, "without a base path both fail to resolve");
});

test("hrefs no site graph can resolve are left to meta.canonical, and other links are not checked", async () => {
  const out = await findings(metaCanonicalTarget, {
    "index.html": PAGE([
      CANONICAL("mailto:a@b.test"),
      CANONICAL("javascript:void(0)"),
      CANONICAL(""),
      '<link rel="canonical" href="ftp://x.test/y.html">', // not http(s), so not a canonical an engine would act on
      '<link rel="alternate" href="/nope">', // not canonical
      '<link rel="stylesheet" href="/nope.css">',
    ].join("\n")),
    "x.html": PAGE(""),
  });
  assert.deepEqual(out, [], "mail, scripts, empty hrefs, and non-http(s) schemes are meta.canonical's business");
});

test("two pages whose canonical links point at each other form a circle of two", async () => {
  const out = await findings(metaCanonicalCycle, {
    "one.html": PAGE(CANONICAL("https://example.test/two.html")),
    "two.html": PAGE(CANONICAL("/one.html")),
  });
  assert.deepEqual(out.map((f) => f.location.file), ["one.html", "two.html"], "one finding per page in the circle");
  for (const finding of out) {
    assert.equal(finding.severity, "warning");
    assert.match(finding.message, /circle of canonical links \(\/one\.html → \/two\.html → \/one\.html\)/);
    assert.equal(finding.fix.kind, "manual");
    assert.match(finding.fix.summary, /ends at a page instead of at another canonical/);
  }
});

test("a circle of three is reported once per member, on its own canonical link", async () => {
  const out = await findings(metaCanonicalCycle, {
    "a.html": PAGE(CANONICAL("https://example.test/b.html")),
    "b.html": PAGE(CANONICAL("https://example.test/c.html")),
    "c.html": PAGE(CANONICAL("https://example.test/a.html")),
  });
  assert.deepEqual(out.map((f) => f.location.file), ["a.html", "b.html", "c.html"]);
  assert.ok(out.every((f) => f.message.includes("/a.html → /b.html → /c.html → /a.html")));
  assert.ok(out.every((f) => f.location.line === 4));
});

test("self-canonicals and chains that reach an endpoint are not circles", async () => {
  const out = await findings(metaCanonicalCycle, {
    "copy.html": PAGE(CANONICAL("https://example.test/original.html")), // points at the one real copy
    "original.html": PAGE(CANONICAL("https://example.test/original.html")), // self-canonical
    "nope.html": PAGE(CANONICAL("/missing.html")), // a broken canonical ends the chain; meta.canonical-target reports it
  });
  assert.deepEqual(out, []);
});
