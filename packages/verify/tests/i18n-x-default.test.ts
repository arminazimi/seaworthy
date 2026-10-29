import assert from "node:assert/strict";
import { test } from "node:test";

import { i18nXDefault } from "../src/checks/i18n-x-default.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { runChecks } from "../src/engine.js";
import { makeSite } from "./helpers.js";

const HEAD = (links: string) => `<head><meta charset="utf-8"><title>t</title>\n${links}</head>\n`;
const PAGE = (lang: string, links: string) => `<!doctype html>\n<html lang="${lang}">\n${HEAD(links)}<body>\n</body>\n</html>\n`;
// A head the author left unclosed: the parser closes it at `<body>`, so it has no end tag to anchor an edit on.
const UNCLOSED = (lang: string, links: string) => `<!doctype html>\n<html lang="${lang}">\n<head><meta charset="utf-8"><title>t</title>\n${links}<body>\n</body>\n</html>\n`;
const ALT = (lang: string, href: string) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;
const X_DEFAULT = (href: string) => ALT("x-default", href);

async function findings(check: Check, files: Record<string, string>): Promise<Finding[]> {
  const site = buildSite(makeSite(files));
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("a site with one language declares no set to fall back from", async () => {
  const out = await findings(i18nXDefault, {
    // every declaration is "en" in some casing, so the site is not multilingual.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("EN", "/de/index.html"), X_DEFAULT("/de/index.html")].join("\n")),
    "de/index.html": PAGE("en", ALT("en", "/de/index.html")),
  });
  assert.deepEqual(out, [], "hreflang declarations cover a single language code, so x-default is not required");
});

test("every page of the set declaring exactly one x-default passes, whatever the casing", async () => {
  const out = await findings(i18nXDefault, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n")),
    "de/index.html": PAGE("de", [ALT("EN", "/index.html"), ALT("de", "/de/"), `<link rel="alternate" hreflang="X-Default" href="/index.html">`].join("\n")),
  });
  assert.deepEqual(out, []);
});

test("a participating page with no x-default is reported once, at its head, with an editable fix", async () => {
  const out = await findings(i18nXDefault, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/"), ALT("en", "/index.html")].join("\n")),
  });
  assert.equal(out.length, 1, "only the page missing the entry is reported");
  assert.match(out[0]!.message, /part of a multilingual hreflang set but declares no hreflang="x-default" entry/);
  assert.equal(out[0]!.location.file, "de/index.html");
  assert.equal(out[0]!.location.line, 3, "the location is the page's <head>, not a link element");
  assert.equal(out[0]!.location.column, 1);
  assert.equal(out[0]!.fix.kind, "edit");
  assert.match(out[0]!.fix.summary, /Add <link rel="alternate" hreflang="x-default" href="\/index\.html"> to this page's head/);
  assert.equal(out[0]!.fix.edits!.length, 1);
  const edit = out[0]!.fix.edits![0]!;
  assert.equal(edit.file, "de/index.html");
  assert.equal(edit.line, 5, "the edit inserts before the page's own </head>, which the template leaves on the last link's line");
  assert.equal(edit.needsInput, true, "only a human knows which page is the default");
  assert.match(edit.replace, /^<link rel="alternate" hreflang="x-default" href="\/index\.html">\n<\/head>$/);
});

test("a page that declares nothing but is named as a translation still needs the x-default entry", async () => {
  const out = await findings(i18nXDefault, {
    // index declares both languages and its own x-default; de/ is only named as the German target.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n")),
    "de/index.html": PAGE("de", ""),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.location.file, "de/index.html");
});

test("a page declaring two x-default entries is reported, with no edit to guess", async () => {
  const out = await findings(i18nXDefault, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html"), X_DEFAULT("/choose/")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/"), ALT("en", "/index.html"), X_DEFAULT("/index.html")].join("\n")),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /declares hreflang="x-default" 2 times/);
  assert.equal(out[0]!.location.file, "index.html");
  assert.equal(out[0]!.fix.kind, "manual");
  assert.match(out[0]!.fix.summary, /Keep exactly one <link rel="alternate" hreflang="x-default" href="..."> on this page/);
  assert.match(out[0]!.fix.summary, /\/index\.html, \/choose\//, "the summary names the competing targets");
  assert.deepEqual(out[0]!.fix.edits, []);
});

test("the missing and the duplicate finding can both be in one run, on different pages", async () => {
  const out = await findings(i18nXDefault, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html"), X_DEFAULT("/choose/")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/"), ALT("en", "/index.html")].join("\n")),
  });
  // Findings come out in the site's page order (de/index.html sorts before index.html).
  assert.deepEqual(out.map((f) => f.location.file), ["de/index.html", "index.html"]);
});

test("pages outside the hreflang set stay silent", async () => {
  const out = await findings(i18nXDefault, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/"), ALT("en", "/index.html"), X_DEFAULT("/index.html")].join("\n")),
    "blog.html": PAGE("en", '<link rel="stylesheet" href="/blog.css">'),
    "legal.html": PAGE("en", ""),
  });
  assert.deepEqual(out, [], "no alternate set, no x-default to declare");
});

test("an x-default entry alone is not a language, and an entry with no href declares nothing", async () => {
  const out = await findings(i18nXDefault, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), X_DEFAULT("/index.html")].join("\n")),
    // German entries without an href: no language is declared, so the site stays single-language.
    "de/index.html": PAGE("de", '<link rel="alternate" hreflang="de"><link rel="alternate" hreflang="en" href="/index.html">'),
  });
  assert.deepEqual(out, []);
});

test("alternates pointing at another host still make the site multilingual and are never fetched", async () => {
  const out = await findings(i18nXDefault, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "https://de.example.test/"), X_DEFAULT("/index.html")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "https://de.example.test/index"), ALT("en", "/index.html")].join("\n")),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.location.file, "de/index.html");
});

test("a head the source never closes gets a manual hint naming the exact tag", async () => {
  const out = await findings(i18nXDefault, {
    "index.html": UNCLOSED("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n") + "\n"),
    "de/index.html": PAGE("de", [ALT("de", "/de/"), ALT("en", "/index.html"), X_DEFAULT("/index.html")].join("\n")),
    "fr/index.html": UNCLOSED("fr", [ALT("fr", "/fr/"), ALT("en", "/index.html")].join("\n") + "\n"),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.location.file, "fr/index.html");
  assert.equal(out[0]!.fix.kind, "manual", "no </head> anchor means no edit is offered, never a guess");
  assert.match(out[0]!.fix.summary, /hreflang="x-default"/);
});
