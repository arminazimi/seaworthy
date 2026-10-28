import assert from "node:assert/strict";
import { test } from "node:test";

import { i18nHreflang } from "../src/checks/i18n.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { runChecks } from "../src/engine.js";
import { makeSite } from "./helpers.js";

const HEAD = (links: string) => `<head><meta charset="utf-8"><title>t</title>\n${links}</head>\n`;
const PAGE = (lang: string, links: string) => `<!doctype html>\n<html lang="${lang}">\n${HEAD(links)}<body>\n</body>\n</html>\n`;
// A page with no html lang at all: the checker cannot know its language key.
const BARE = (links: string) => `<!doctype html>\n<html>\n${HEAD(links)}<body>\n</body>\n</html>\n`;
const ALT = (lang: string, href: string) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;

async function findings(check: Check, files: Record<string, string>, opts: { basePath?: string } = {}): Promise<Finding[]> {
  const site = buildSite(makeSite(files), opts.basePath === undefined ? {} : { basePath: opts.basePath });
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("a reciprocal pair with directory forms and a casing difference is fine", async () => {
  const out = await findings(i18nHreflang, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/"), ALT("EN", "/")].join("\n")),
  });
  assert.deepEqual(out, []);
});

test("pages that only declare themselves are fine (no alternates, or a self-reference per language)", async () => {
  const out = await findings(i18nHreflang, {
    "index.html": PAGE("en", ""),
    "about.html": PAGE("en", ALT("en", "/about.html")),
    "x-default-test.html": PAGE("en", `<link rel="alternate" hreflang="x-default" href="/index.html">`),
  });
  assert.deepEqual(out, [], "x-default declares no language, so it is out of scope here and reported as nothing");
});

test("an hreflang target that no page serves is reported at the hreflang attribute", async () => {
  const out = await findings(i18nHreflang, {
    "index.html": PAGE("en", ALT("es", "/es/a-propos.html")),
    "de/about.html": PAGE("de", ""),
  });
  assert.equal(out.length, 1, "exactly one finding for the dangling entry");
  assert.match(out[0]!.message, /declares hreflang="es" pointing at \/es\/a-propos\.html, but no page in the built site serves it/);
  assert.equal(out[0]!.location.file, "index.html");
  assert.equal(out[0]!.location.line, 4);
  assert.equal(out[0]!.location.column, 23, "the location is the hreflang attribute, not the element");
  assert.match(out[0]!.fix.summary, /page the build serves/);
  assert.equal(out[0]!.fix.kind, "manual");
});

test("a target page that links nothing back is reported once, per declaring page", async () => {
  const out = await findings(i18nHreflang, {
    "index.html": PAGE("en", ALT("de", "/de/about.html")),
    "de/about.html": PAGE("de", ""),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /declares hreflang="de" pointing at \/de\/about\.html, but that page declares no hreflang="en" alternate back to this page/);
  assert.match(out[0]!.fix.summary, /Add <link rel="alternate" hreflang="en" href="\/index\.html"> to \/de\/about\.html/);
  assert.equal(out[0]!.fix.kind, "edit");
  assert.deepEqual(out[0]!.fix.edits.map((e) => e.file), ["de/about.html"]);
});

test("reversed direction: the other side of a pair that is missing one back-link is also checked", async () => {
  const out = await findings(i18nHreflang, {
    "index.html": PAGE("en", ALT("de", "/de/about.html")),
    "de/about.html": PAGE("de", [ALT("de", "/de/about.html"), ALT("en", "/index.html")].join("\n")),
    "fr/a-propos.html": PAGE("fr", [ALT("de", "/de/about.html")].join("\n")),
  });
  // de/about links back to index for "en", so index's de entry passes; fr's de entry needs a
  // lang="fr" alternate on de/about, which no page declares.
  assert.equal(out.length, 1);
  assert.equal(out[0]!.location.file, "fr/a-propos.html");
  assert.match(out[0]!.message, /declares no hreflang="fr" alternate back to this page/);
});

test("language keys match without regard to case, in both directions", async () => {
  const out = await findings(i18nHreflang, {
    "index.html": PAGE("en", ALT("DE", "/de/about.html")),
    "de/about.html": PAGE("DE", ALT("en", "/index.html")),
  });
  assert.deepEqual(out, []);
});

test("external hreflang URLs are never fetched and never reported", async () => {
  const out = await findings(i18nHreflang, {
    "index.html": PAGE("en", [
      ALT("de", "https://other.test/de/about"),
      ALT("fr", "//other.test/fr"),
      ALT("es", "mailto:es@other.test"),
    ].join("\n")),
  });
  assert.deepEqual(out, [], "an address outside this build cannot be verified offline, so it is skipped");
});

test("a base path is stripped the way the host would serve the URL", async () => {
  const files = {
    "index.html": PAGE("en", [ALT("en", "/repo/"), ALT("de", "/repo/de/")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/repo/de/"), ALT("en", "/repo/")].join("\n")),
  };
  assert.deepEqual(await findings(i18nHreflang, files, { basePath: "/repo/" }), [], "with the base path both directions resolve");
  // Without it, the same pairs do not resolve and every entry is dangling.
  const out = await findings(i18nHreflang, files);
  assert.equal(out.length, 4);
  assert.ok(out.every((f) => /no page in the built site serves it/.test(f.message)));
});
