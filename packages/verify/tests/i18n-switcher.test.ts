import assert from "node:assert/strict";
import { test } from "node:test";

import { i18nSwitcher } from "../src/checks/i18n-switcher.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { runChecks } from "../src/engine.js";
import { makeSite } from "./helpers.js";

// Line map of PAGE with two declaration lines: 1 doctype, 2 html, 3 head, 4-5 <link>s, 6 </head>, 7 <body>, 8+ body lines.
const HEAD = (links: string) => `<head><meta charset="utf-8"><title>t</title>\n${links}\n</head>\n`;
const PAGE = (lang: string, links: string, body: string) => `<!doctype html>\n<html lang="${lang}">\n${HEAD(links)}<body>\n${body}\n</body>\n</html>\n`;
const ALT = (lang: string, href: string) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;
// A switcher link written at the start of its line: its `href` attribute sits at column 18 (`<a ` + `hreflang="de"` + ` `).
const LINK = (lang: string, href: string, label = "x") => `<a hreflang="${lang}" href="${href}">${label}</a>`;

async function findings(check: Check, files: Record<string, string>): Promise<Finding[]> {
  const site = buildSite(makeSite(files));
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("correct switchers are silent, including the current-language marker and path-style matches", async () => {
  const out = await findings(i18nSwitcher, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html")].join("\n"), [LINK("en", "/index.html", "English"), LINK("de", "/de/", "Deutsch")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/index.html"), ALT("en", "/index.html")].join("\n"), [LINK("de", "/de/index.html", "Deutsch"), LINK("en", "/index.html", "English")].join("\n")),
  });
  assert.deepEqual(out, [], "each switcher lands on the page its own document declares for that language; /de/ and /de/index.html are the same page");
});

test("a switcher at the other language's home page instead of the same article is reported at its href, with an exact edit", async () => {
  const out = await findings(i18nSwitcher, {
    "about.html": PAGE("en", [ALT("en", "/about.html"), ALT("de", "/de/about.html")].join("\n"), LINK("de", "/index.html", "Deutsch")),
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html")].join("\n"), ""),
    "de/about.html": PAGE("de", [ALT("de", "/de/about.html"), ALT("en", "/about.html")].join("\n"), ""),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /hreflang="de" switcher lands on \/index\.html, but the page declares href="\/de\/about\.html" as its hreflang="de" alternate/);
  assert.equal(out[0]!.location.file, "about.html");
  assert.equal(out[0]!.location.line, 8);
  assert.equal(out[0]!.location.column, 18, "the location is the href attribute of the <a>, so line and column are exact");
  assert.equal(out[0]!.fix.kind, "edit");
  assert.equal(out[0]!.fix.edits!.length, 1);
  assert.equal(out[0]!.fix.edits![0]!.find, 'href="/index.html"');
  assert.equal(out[0]!.fix.edits![0]!.replace, 'href="/de/about.html"');
});

test("a switcher that links back to the current page itself is reported", async () => {
  const out = await findings(i18nSwitcher, {
    "about.html": PAGE("en", [ALT("en", "/about.html"), ALT("de", "/de/about.html")].join("\n"), LINK("de", "/about.html", "Deutsch")),
    "de/about.html": PAGE("de", [ALT("de", "/de/about.html"), ALT("en", "/about.html")].join("\n"), ""),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /switcher links back to this very page \(\/about\.html\)/);
  assert.equal(out[0]!.fix.kind, "edit", "the page declares exactly one alternate for the language, so the edit is unambiguous");
  assert.equal(out[0]!.fix.edits![0]!.replace, 'href="/de/about.html"');
});

test("a switcher at a page the built site does not serve is reported and edited to the declared alternate", async () => {
  const out = await findings(i18nSwitcher, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html")].join("\n"), LINK("de", "/de/start.html", "Deutsch")),
    "de/index.html": PAGE("de", [ALT("de", "/de/index.html"), ALT("en", "/index.html")].join("\n"), ""),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /points at \/de\/start\.html, a page the built site does not serve/);
  assert.equal(out[0]!.fix.kind, "edit");
  assert.equal(out[0]!.fix.edits![0]!.replace, 'href="/de/index.html"');
});

test("a switcher outside the built site is reported, unless the page declares that exact external URL as its alternate", async () => {
  const wrong = await findings(i18nSwitcher, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html")].join("\n"), LINK("de", "https://de.example.test/", "Deutsch")),
    "de/index.html": PAGE("de", [ALT("de", "/de/index.html"), ALT("en", "/index.html")].join("\n"), ""),
  });
  assert.equal(wrong.length, 1);
  assert.match(wrong[0]!.message, /switcher leaves the built site to https:\/\/de\.example\.test\/, but the page declares href="\/de\/index\.html"/);
  assert.equal(wrong[0]!.fix.kind, "edit");
  assert.equal(wrong[0]!.fix.edits![0]!.replace, 'href="/de/index.html"');

  const agreed = await findings(i18nSwitcher, {
    // A site hosting its German pages on another domain, declared and linked consistently, is fine.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "https://de.example.test/")].join("\n"), LINK("de", "https://de.example.test/", "Deutsch")),
  });
  assert.deepEqual(agreed, []);
});

test("a switcher whose href goes nowhere is reported, empty href and non-page schemes alike", async () => {
  const out = await findings(i18nSwitcher, {
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html")].join("\n"), [LINK("de", "mailto:de@example.test", "Mail"), LINK("de", "", "Empty")].join("\n")),
  });
  assert.equal(out.length, 2, "reported in document order");
  assert.match(out[0]!.message, /goes to mailto:de@example\.test, which is not a page/);
  assert.equal(out[0]!.location.line, 8);
  assert.match(out[1]!.message, /has an empty href, so it lands nowhere/);
  assert.equal(out[1]!.location.line, 9);
  assert.equal(out[1]!.fix.edits![0]!.find, 'href=""');
});

test("a page without its own alternate set is skipped: nothing to compare against", async () => {
  const out = await findings(i18nSwitcher, {
    "index.html": PAGE("en", "", LINK("de", "/gone.html", "Deutsch")),
    "de/index.html": PAGE("de", "", ""),
  });
  assert.deepEqual(out, [], "the switcher may well be wrong, but this check cannot prove it from the page's own declarations");
});

test("link elements are i18n.hreflang's contract, never reported twice here", async () => {
  const out = await findings(i18nSwitcher, {
    // A dangling, unreciprocal declaration with no <a> switcher anywhere: i18n.hreflang's finding, not this check's.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/does-not-exist.html")].join("\n"), "<p>Hello.</p>"),
  });
  assert.deepEqual(out, []);
});

test("hidden, scripted, templated, SVG, and href-less links are not visible switchers", async () => {
  const out = await findings(i18nSwitcher, {
    "index.html": PAGE(
      "en",
      [ALT("en", "/index.html"), ALT("de", "/de/index.html")].join("\n"),
      [
        '<a hreflang="de" href="/blog.html" hidden>Deutsch</a>',
        '<div aria-hidden="true"><a hreflang="de" href="/blog.html">Deutsch</a></div>',
        "<template><a hreflang=\"de\" href=\"/blog.html\">Deutsch</a></template>",
        "<script>document.write('<a hreflang=\"de\" href=\"/blog.html\">js</a>');</script>",
        "<svg><a hreflang=\"de\" href=\"/blog.html\"><text>DE</text></a></svg>",
        '<a hreflang="de">no href</a>',
      ].join("\n"),
    ),
    "blog.html": PAGE("en", "", ""),
    "de/index.html": PAGE("de", [ALT("de", "/de/index.html"), ALT("en", "/index.html")].join("\n"), ""),
  });
  assert.deepEqual(out, [], "a reader never sees these, so none of them is a language switcher");
});

test("x-default is not a language: its switcher links are left alone and its entry is not an alternate set", async () => {
  const out = await findings(i18nSwitcher, {
    // The fallback switcher goes nowhere near the declared fallback, and to a page that does not even exist:
    // still silent, because x-default is `i18n.x-default`'s business and the empty href is `links.internal`'s.
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html"), ALT("x-default", "/index.html")].join("\n"), [LINK("x-default", "/no-such-page.html"), LINK("de", "/de/index.html")].join("\n")),
    // A page whose only alternate entry is x-default declares no language: nothing to compare against.
    "blog.html": PAGE("en", ALT("X-Default", "/index.html"), LINK("de", "/elsewhere.html")),
    "de/index.html": PAGE("de", [ALT("de", "/de/index.html"), ALT("en", "/index.html")].join("\n"), ""),
  });
  assert.deepEqual(out, []);
});

test("language keys are compared without regard to case", async () => {
  const out = await findings(i18nSwitcher, {
    "index.html": PAGE("en", [ALT("EN", "/index.html"), ALT("de", "/de/index.html")].join("\n"), [LINK("En", "/index.html"), LINK("DE", "/de/index.html")].join("\n")),
    "de/index.html": PAGE("de", [ALT("de", "/de/index.html"), ALT("en", "/index.html")].join("\n"), ""),
  });
  assert.deepEqual(out, []);
});

test("two declarations for one language make the fix manual and name both", async () => {
  const out = await findings(i18nSwitcher, {
    "about.html": PAGE("en", [ALT("en", "/about.html"), ALT("de", "/de/about.html"), ALT("de", "/de/ueber-uns.html")].join("\n"), LINK("de", "/index.html", "Deutsch")),
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html")].join("\n"), ""),
    "de/about.html": PAGE("de", "", ""),
    "de/ueber-uns.html": PAGE("de", "", ""),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /href="\/de\/about\.html" or href="\/de\/ueber-uns\.html" as its hreflang="de" alternates/);
  assert.equal(out[0]!.location.line, 9);
  assert.equal(out[0]!.fix.kind, "manual", "two declared alternates: the intended page is not unambiguous, so no edit is guessed");
  assert.deepEqual(out[0]!.fix.edits, []);
  assert.match(out[0]!.fix.summary, /declares 2 different hreflang="de" alternates \(\/de\/about\.html, \/de\/ueber-uns\.html\)/);
});

test("a switcher for a language the page does not declare is reported, manually", async () => {
  const out = await findings(i18nSwitcher, {
    "about.html": PAGE("en", [ALT("en", "/about.html"), ALT("de", "/de/about.html")].join("\n"), LINK("fr", "/de/about.html", "Français")),
    "de/about.html": PAGE("de", "", ""),
  });
  assert.equal(out.length, 1);
  assert.match(out[0]!.message, /but the page declares no hreflang="fr" alternate/);
  assert.equal(out[0]!.fix.kind, "manual");
  assert.match(out[0]!.fix.summary, /Give this page an alternate for fr/, "the summary names the language and what to declare");
});

test("findings follow site page order and document order, never Map insertion luck", async () => {
  const out = await findings(i18nSwitcher, {
    "a.html": PAGE("en", [ALT("en", "/a.html"), ALT("de", "/de/a.html")].join("\n"), [LINK("de", "/b.html", "one"), LINK("de", "/index.html", "two")].join("\n")),
    "b.html": PAGE("en", [ALT("en", "/b.html"), ALT("de", "/de/b.html")].join("\n"), LINK("de", "/a.html", "three")),
    "index.html": PAGE("en", [ALT("en", "/index.html"), ALT("de", "/de/index.html")].join("\n"), ""),
    "de/a.html": PAGE("de", "", ""),
    "de/b.html": PAGE("de", "", ""),
    "de/index.html": PAGE("de", [ALT("de", "/de/index.html"), ALT("en", "/index.html")].join("\n"), ""),
  });
  assert.deepEqual(
    out.map((f) => [f.location.file, f.location.line]),
    [
      ["a.html", 8],
      ["a.html", 9],
      ["b.html", 8],
    ],
  );
});
