// i18n.hreflang: hreflang alternate link sets are reciprocal and point at pages of the built site.
// Handling of `x-default` entries lives in the follow-up check `i18n.x-default` (issue #369).

import { type HtmlElement, type Page, type SiteGraph, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, firstElement, insertInHead, locate, meta, pagesOf } from "./helpers.js";

const ALTERNATE = /(^|\s)alternate(\s|$)/i;

interface Alternate {
  /** The value exactly as written in the source. */
  lang: string;
  /** The normalized key: trimmed, lower-cased. Language matching ignores case, as the spec requires. */
  key: string;
  href: string;
  element: HtmlElement;
}

/** The `rel="alternate" hreflang=...` link elements of a page, in document order. */
function alternatesOf(page: Page): Alternate[] {
  const out: Alternate[] = [];
  for (const element of page.elements) {
    if (element.tagName !== "link") continue;
    if (!ALTERNATE.test(attr(element, "rel") ?? "")) continue;
    const lang = attr(element, "hreflang");
    if (lang === undefined || lang.trim() === "") continue;
    const href = (attr(element, "href") ?? "").trim();
    // An x-default entry is not a language declaration; `i18n.x-default` checks it, so it stays untouched here.
    const key = lang.trim().toLowerCase();
    if (key === "x-default" || href === "") continue;
    out.push({ lang, key, href, element });
  }
  return out;
}

/** The page's own language key, from `<html lang>`, normalized; undefined when the page declares none. */
function pageLang(page: Page): string | undefined {
  const html = firstElement(page, "html");
  const lang = html ? attr(html, "lang")?.trim().toLowerCase() : undefined;
  return lang === "" ? undefined : lang;
}

/** True when `from` declares an alternate for `lang` that points at the page `target` serves. */
function linksBackTo(site: SiteGraph, from: Page, lang: string, target: { readonly url: string }): boolean {
  for (const alternate of alternatesOf(from)) {
    if (alternate.key !== lang) continue;
    const back = site.resolveLink(from.url, alternate.href);
    if (back.kind === "internal" && back.file === target.url) return true;
  }
  return false;
}

export const i18nHreflang = check(
  meta("i18n.hreflang", "hreflang alternate set is not reciprocal or points at a page that does not exist", "warning", ["Google rel=alternate hreflang"]),
  (ctx) => {
    const { site } = ctx;
    const out: FindingDraft[] = [];
    for (const page of pagesOf(ctx)) {
      const lang = pageLang(page);
      for (const alternate of alternatesOf(page)) {
        // External hreflang links are never fetched and not reported: only entries that resolve inside
        // this build can be verified offline.
        const target = site.resolveLink(page.url, alternate.href);
        if (target.kind !== "internal") continue;
        const location = locate(page, alternate.element, "hreflang");

        if (target.file === undefined) {
          out.push({
            message: `This page declares hreflang="${alternate.lang}" pointing at ${alternate.href}, but no page in the built site serves it.`,
            location,
            fix: {
              kind: "manual",
              summary: `Point the hreflang attribute at a page the build serves (for example an existing translation), or build the page it describes. One unresolvable entry makes search engines distrust the whole alternate set.`,
              edits: [],
            },
            key: `missing:${alternate.key}:${alternate.href}`,
          });
          continue;
        }

        const destination = site.pages.get(target.file);
        if (destination === undefined) continue;
        // Reciprocity needs this page's language key; when the page declares none (no html lang),
        // the key to demand back is unknown, so the check degrades to silence here.
        if (lang === undefined) continue;
        if (linksBackTo(site, destination, lang, page)) continue;
        const edit = insertInHead(destination, `<link rel="alternate" hreflang="${lang}" href="${page.url}">`);
        out.push({
          message: `This page declares hreflang="${alternate.lang}" pointing at ${destination.url}, but that page declares no hreflang="${lang}" alternate back to this page.`,
          location,
          fix: {
            kind: edit ? "edit" : "manual",
            summary: `Add <link rel="alternate" hreflang="${lang}" href="${page.url}"> to ${destination.url}, or remove this alternate if the two pages are not translations of each other.`,
            edits: edit ? [edit] : [],
          },
          key: `not-reciprocal:${alternate.key}:${alternate.href}`,
        });
      }
    }
    return out;
  },
);
