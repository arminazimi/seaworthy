import assert from "node:assert/strict";
import { test } from "node:test";

import { i18nParity } from "../src/checks/i18n-parity.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { runChecks } from "../src/engine.js";
import { makeSite } from "./helpers.js";

const HEAD = (links: string) => `<head><meta charset="utf-8"><title>t</title>\n${links}</head>\n`;
const PAGE = (lang: string, links: string) => `<!doctype html>\n<html lang="${lang}">\n${HEAD(links)}<body>\n</body>\n</html>\n`;
const ALT = (lang: string, href: string) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;
const X_DEFAULT = (href: string) => ALT("x-default", href);

async function findings(check: Check, files: Record<string, string>, options: Record<string, unknown> = {}): Promise<Finding[]> {
  const site = buildSite(makeSite(files));
  const result = await runChecks({ site, checks: [check], ...(Object.keys(options).length > 0 ? { options: { "i18n.parity": options } } : {}) });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("a fully translated set declares every language and serves every language", async () => {
  const out = await findings(i18nParity, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n")),
    "de/index.html": PAGE("de", [ALT("DE", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n")),
  });
  assert.deepEqual(out, [], "the set serves en and de, so parity holds");
});

test("a page whose set declares a language no member serves is reported once", async () => {
  const out = await findings(i18nParity, {
    // index and its German twin are complete; about promises a German page the build never emitted.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/"), ALT("en", "/index.html"), X_DEFAULT("/index.html")].join("\n")),
    "about.html": PAGE("en", [ALT("en", "/about.html"), ALT("de", "/de/about.html")].join("\n")),
  });
  assert.equal(out.length, 1, "only the set with the gap is reported");
  assert.equal(out[0]!.location.file, "about.html");
  assert.equal(out[0]!.location.line, 3, "the location is the declaring page's <head>");
  assert.equal(out[0]!.location.column, 1);
  assert.match(out[0]!.message, /The hreflang set of about\.html declares the language "de", but no page of the set serves it/);
  assert.equal(out[0]!.fix.kind, "manual", "creating a translated page is not a text edit");
  assert.deepEqual(out[0]!.fix.edits, []);
  assert.match(out[0]!.fix.summary, /Create the "de" version/);
  assert.match(out[0]!.fix.summary, /options\.untranslated/, "the hint names the opt-out for intentional gaps");
});

test("the message names the whole cluster, sorted, when its existing page misses a language", async () => {
  const out = await findings(i18nParity, {
    // The en and de pages link each other and both also promise French; no page serves fr.
    "about.html": PAGE("en", [ALT("en", "/about.html"), ALT("de", "/de/about.html"), ALT("fr", "/fr/about.html")].join("\n")),
    "de/about.html": PAGE("de", [ALT("de", "/de/about.html"), ALT("en", "/about.html"), ALT("fr", "/fr/about.html")].join("\n")),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /The hreflang set of about\.html, de\/about\.html declares the language "fr"/, "the cluster is named by its member pages, sorted");
  assert.equal(out[0]!.location.file, "about.html", "reported at the first page, sorted, that declares the language");
});

test("monolingual sites never fire", async () => {
  const out = await findings(i18nParity, {
    "index.html": PAGE("en", ALT("en", "/index.html")),
    "blog.html": PAGE("en", [ALT("en", "/blog.html"), ALT("en", "/index.html")].join("\n")),
    "legal.html": PAGE("en", ""),
  });
  assert.deepEqual(out, [], "a site that declares one language asks for no translation");
});

test("a page that declares nothing but is named as a translation joins the cluster and can serve its language", async () => {
  const out = await findings(i18nParity, {
    // de/index.html emits no alternates at all; it joins through index's hreflang link, and its
    // <html lang="de"> is what serves German for the set.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/")].join("\n")),
    "de/index.html": PAGE("de", ""),
  });
  assert.deepEqual(out, [], "the named page serves de via <html lang>, so the set is complete");
  const broken = await findings(i18nParity, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/")].join("\n")),
    "de/index.html": PAGE("en", ""),
  });
  assert.equal(broken.length, 1, "a named page that serves en too leaves the set without a German page");
  assert.match(broken[0]!.message, /de\/index\.html, index\.html/);
});

test("the untranslated option silences a declared gap, by path or by URL", async () => {
  const files = {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/")].join("\n")),
    "legal.html": PAGE("en", [ALT("en", "/legal.html"), ALT("de", "/de/legal.html")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/"), ALT("en", "/index.html")].join("\n")),
  };
  const before = await findings(i18nParity, files);
  assert.equal(before.length, 1);
  const byPath = await findings(i18nParity, files, { untranslated: { de: ["legal.html"] } });
  assert.deepEqual(byPath, [], "naming any page of the set under the language opts the pair out");
  const byUrl = await findings(i18nParity, files, { untranslated: { de: ["/legal.html"] } });
  assert.deepEqual(byUrl, [], "a leading slash is the same page path");
  const wrongLang = await findings(i18nParity, files, { untranslated: { fr: ["legal.html"] } });
  assert.equal(wrongLang.length, 1, "an entry under another language does not cover de");
});

test("malformed option values are ignored, exactly like quality.page-weight budgets", async () => {
  const files = {
    "legal.html": PAGE("en", [ALT("en", "/legal.html"), ALT("de", "/de/legal.html")].join("\n")),
  };
  const out = await findings(i18nParity, files, { untranslated: "legal.html" });
  assert.equal(out.length, 1, "a value that is not an object turns the option off; the gap is still reported");
  const notList = await findings(i18nParity, files, { untranslated: { de: "legal.html" } });
  assert.equal(notList.length, 1, "a language whose entry is not an array is ignored");
  const badEntries = await findings(i18nParity, files, { untranslated: { de: [42, null, ""] } });
  assert.equal(badEntries.length, 1, "non-string and blank paths are skipped");
  const unknown = await findings(i18nParity, files, { untranslated: { klingon: ["legal.html"] } });
  assert.equal(unknown.length, 1, "an unknown language is simply never referenced");
});

test("x-default is not a language, and a page named only as the x-default target does not join the cluster", async () => {
  const out = await findings(i18nParity, {
    // index promises a German page that does not exist; choose.html is only the fallback target.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html"), X_DEFAULT("/choose.html")].join("\n")),
    "choose.html": PAGE("en", X_DEFAULT("/choose.html")),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /The hreflang set of index\.html declares the language "de"/, "the x-default target is not a member of the set");
  assert.doesNotMatch(out[0]!.message, /choose\.html|x-default/, "x-default names neither a member nor a language");
});

test("a site whose only entries are x-default declares no language and reports nothing", async () => {
  const out = await findings(i18nParity, {
    "index.html": PAGE("en", [X_DEFAULT("/index.html"), X_DEFAULT("/de/")].join("\n")),
    "de/index.html": PAGE("de", X_DEFAULT("/index.html")),
  });
  assert.deepEqual(out, [], "x-default entries alone build no cluster");
});

test("a language declared only outside this build is never demanded offline", async () => {
  const out = await findings(i18nParity, {
    // The German version lives on another host: the set declares de, but not for this build to serve.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "https://de.example.test/")].join("\n")),
  });
  assert.deepEqual(out, []);
});

test("findings come out in sorted cluster and language order, never insertion luck", async () => {
  const out = await findings(i18nParity, {
    // Two sets with gaps; "contact.html..." sorts before "index.html", and de sorts before fr inside each set.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("fr", "/fr/"), ALT("de", "/de/")].join("\n")),
    "contact.html": PAGE("en", [ALT("en", "/contact.html"), ALT("de", "/de/contact.html"), ALT("fr", "/fr/contact.html")].join("\n")),
  });
  assert.deepEqual(
    out.map((f) => [f.location.file, f.message.match(/the language "(\w+)"/)![1]]),
    [
      ["contact.html", "de"],
      ["contact.html", "fr"],
      ["index.html", "de"],
      ["index.html", "fr"],
    ],
  );
});

test("an entry with no href declares nothing usable, as in the sibling checks", async () => {
  const out = await findings(i18nParity, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), '<link rel="alternate" hreflang="de">', ALT("de", "/de/"), X_DEFAULT("/index.html")].join("\n")),
    "de/index.html": PAGE("de", ""),
  });
  assert.deepEqual(out, [], "the usable de entry resolves to the German page, so the set is complete");
});
