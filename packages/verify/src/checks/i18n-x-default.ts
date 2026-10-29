// i18n.x-default: on a multilingual site every page of an hreflang set declares exactly one `x-default` entry.

import { type Page, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, documentLocation, insertInHead, meta, pagesOf } from "./helpers.js";

const ALTERNATE = /(^|\s)alternate(\s|$)/i;
/** The fallback declaration: not a language, so it never joins the language set. */
const X_DEFAULT = "x-default";

interface AlternateLink {
  /** The normalized `hreflang` key: trimmed, lower-cased. Language matching ignores case, as the spec requires. */
  key: string;
  href: string;
}

/**
 * The `rel="alternate" hreflang=...` link elements of a page, in document order, `x-default` entries included.
 * An entry without an `href` declares nothing usable and is left out, exactly as `i18n.hreflang` leaves it out.
 * This scan is the sibling check's, copied on purpose: `i18n.ts` stays untouched so parallel work on it cannot collide.
 */
function alternatesOf(page: Page): AlternateLink[] {
  const out: AlternateLink[] = [];
  for (const element of page.elements) {
    if (element.tagName !== "link") continue;
    if (!ALTERNATE.test(attr(element, "rel") ?? "")) continue;
    const lang = attr(element, "hreflang");
    if (lang === undefined || lang.trim() === "") continue;
    const href = (attr(element, "href") ?? "").trim();
    if (href === "") continue;
    out.push({ key: lang.trim().toLowerCase(), href });
  }
  return out;
}

/** The placeholder the fix hint offers: only a human knows which page is the site's fallback. */
const SUGGESTED = '<link rel="alternate" hreflang="x-default" href="/index.html">';

export const i18nXDefault = check(
  meta("i18n.x-default", "a page of a multilingual hreflang set declares no x-default, or more than one", "warning", ["Google rel=alternate hreflang"]),
  (ctx) => {
    const { site } = ctx;
    const declarations = pagesOf(ctx).map((page) => ({ page, alternates: alternatesOf(page) }));

    // What the site declares as a whole: the language codes in use, and the pages other pages name as their
    // translations. Entries pointing outside this build count as declarations; they are simply never fetched.
    const languages = new Set<string>();
    const translatedPages = new Set<string>();
    for (const { page, alternates } of declarations) {
      for (const alternate of alternates) {
        if (alternate.key === X_DEFAULT) continue;
        languages.add(alternate.key);
        const target = site.resolveLink(page.url, alternate.href);
        if (target.kind === "internal" && target.file !== undefined) translatedPages.add(target.file);
      }
    }
    // One language is not a multilingual site, so nothing has to fall back anywhere.
    if (languages.size < 2) return [];

    const out: FindingDraft[] = [];
    for (const { page, alternates } of declarations) {
      const defaults = alternates.filter((alternate) => alternate.key === X_DEFAULT);

      if (defaults.length > 1) {
        const hrefs = [...new Set(defaults.map((alternate) => alternate.href))].join(", ");
        out.push({
          message: `This page declares hreflang="x-default" ${defaults.length} times, so its multilingual alternate set has more than one fallback page.`,
          location: documentLocation(page),
          fix: {
            kind: "manual",
            summary: `Keep exactly one <link rel="alternate" hreflang="x-default" href="..."> on this page. ${defaults.length} entries compete (${hrefs}): keep the language-selection or default-language page and remove the others in the source that emits these tags.`,
            edits: [],
          },
          key: "x-default:duplicate",
        });
        continue;
      }
      if (defaults.length === 1) continue;

      // A page belongs to the set when it declares a language alternate itself or another page names it as
      // a translation. A page outside the set declares no languages, so it owes no fallback.
      const declaresLanguage = alternates.some((alternate) => alternate.key !== X_DEFAULT);
      if (!declaresLanguage && !translatedPages.has(page.url)) continue;

      const edit = insertInHead(page, `${SUGGESTED}\n`);
      out.push({
        message: `This page is part of a multilingual hreflang set but declares no hreflang="x-default" entry, so nothing marks which page to use when the visitor's language is missing.`,
        location: documentLocation(page),
        fix: {
          kind: edit ? "edit" : "manual",
          summary: `Add ${SUGGESTED} to this page's head, with the href pointing at the language-selection or default-language page of the site. The href it shows is a placeholder: only you know which page that is.`,
          edits: edit ? [edit] : [],
        },
        key: "x-default:missing",
      });
    }
    return out;
  },
);
