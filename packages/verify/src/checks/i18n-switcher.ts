// i18n.switcher: a visible link carrying an `hreflang` attribute — the standard language-switcher markup —
// must land on the page this same page declares as its alternate for that language.
// `<link rel="alternate">` entries are `i18n.hreflang`'s contract and `x-default` declarations are `i18n.x-default`'s:
// this check reads the `<a>` elements a person clicks, never the `<link>` elements a crawler reads.

import { type HtmlElement, type LinkTarget, type Page, type SiteGraph, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { ancestors, check, isHidden, locate, meta, pagesOf, replaceAttribute } from "./helpers.js";

const ALTERNATE = /(^|\s)alternate(\s|$)/i;
/** The fallback marker of the hreflang contract: not a language, so the language rule never applies to it. */
const X_DEFAULT = "x-default";
/** A reader never sees markup inside these, and HTML attributes such as `hreflang` carry no language meaning inside `svg` or `math`. */
const NOT_A_SWITCHER_CONTEXT = new Set(["script", "style", "template", "noscript", "svg", "math"]);

interface Switcher {
  element: HtmlElement;
  /** The `hreflang` value exactly as written in the source. */
  lang: string;
  /** The normalized key: trimmed, lower-cased. Language matching ignores case, as the spec requires. */
  key: string;
  /** The `href` value exactly as written. */
  href: string;
}

/**
 * The page's switcher links, in document order. Recognition is markup-only on purpose: a visible `<a>`
 * that carries an `hreflang` attribute and an `href`. Link text ("English", "DE", "Deutsch") and nav class
 * names are guesses, and a false accusation costs more than a missed switcher, so this check stays provable.
 */
function switchersOf(page: Page): Switcher[] {
  const out: Switcher[] = [];
  for (const element of page.elements) {
    if (element.tagName !== "a") continue;
    const lang = attr(element, "hreflang");
    if (lang === undefined || lang.trim() === "") continue;
    const key = lang.trim().toLowerCase();
    if (key === X_DEFAULT) continue; // not a language; `i18n.x-default` owns what the fallback entry declares.
    const href = attr(element, "href");
    if (href === undefined) continue; // no destination at all: a placeholder, not a link to land anywhere.
    if (isHidden(element)) continue;
    if (ancestors(element).some((e) => NOT_A_SWITCHER_CONTEXT.has(e.tagName))) continue;
    out.push({ element, lang, key, href });
  }
  return out;
}

/**
 * What the built site resolves a link to, as a comparable identity: two links agree when a person
 * clicking either arrives at the same page — path styles (`/de/`, `/de/about.html`), query strings and
 * fragments aside. An unresolved target compares by its path, so a declaration and a switcher that name
 * the same missing page agree and stay out of this check's way.
 */
function identityOf(target: LinkTarget): string {
  if (target.kind === "internal") return target.file === undefined ? `missing:${target.path}` : `page:${target.file}`;
  return `${target.kind}:${target.href.trim()}`;
}

interface Declaration {
  /** The declared href, as written: what the fix hint offers when it is unambiguous. */
  href: string;
  identity: string;
}

/**
 * The page's own `rel="alternate" hreflang=...` declarations, keyed by language, each list in document order.
 * The exclusions are `i18n.hreflang`'s: an `x-default` entry is not a language, and an empty href declares nothing.
 * This scan is the sibling checks', copied on purpose: `i18n.ts` stays untouched so parallel work cannot collide.
 */
function declaredAlternates(site: SiteGraph, page: Page): Map<string, Declaration[]> {
  const declared = new Map<string, Declaration[]>();
  for (const element of page.elements) {
    if (element.tagName !== "link") continue;
    if (!ALTERNATE.test(attr(element, "rel") ?? "")) continue;
    const lang = attr(element, "hreflang");
    if (lang === undefined || lang.trim() === "") continue;
    const href = (attr(element, "href") ?? "").trim();
    const key = lang.trim().toLowerCase();
    if (key === X_DEFAULT || href === "") continue;
    const entry: Declaration = { href, identity: identityOf(site.resolveLink(page.url, href)) };
    const list = declared.get(key);
    if (list === undefined) declared.set(key, [entry]);
    else list.push(entry);
  }
  return declared;
}

/** How the switcher's target reads in the finding message, from the resolved link and the page it lands on. */
function describeLanding(site: SiteGraph, page: Page, link: Switcher, target: LinkTarget): string {
  if (target.kind === "ignored") return link.href.trim() === "" ? "has an empty href, so it lands nowhere" : `goes to ${link.href.trim()}, which is not a page`;
  if (target.kind === "external") return `leaves the built site to ${link.href.trim()}`;
  if (target.file === undefined) return `points at ${link.href.trim()}, a page the built site does not serve`;
  if (target.file === page.url) return `links back to this very page (${page.url})`;
  const destination = site.pages.get(target.file);
  return `lands on ${destination === undefined ? target.path : destination.url}`;
}

export const i18nSwitcher = check(
  meta("i18n.switcher", "language switcher link does not land on the alternate this page declares for that language", "warning", ["Google rel=alternate hreflang"]),
  (ctx) => {
    const { site } = ctx;
    const out: FindingDraft[] = [];
    for (const page of pagesOf(ctx)) {
      const switchers = switchersOf(page);
      if (switchers.length === 0) continue;
      const declared = declaredAlternates(site, page);
      // Nothing to compare against: a page with no alternate set is left alone, exactly as `i18n.hreflang`
      // degrades to silence when a page declares no language.
      if (declared.size === 0) continue;

      for (const link of switchers) {
        const target = site.resolveLink(page.url, link.href);
        const entries = declared.get(link.key);
        if (entries !== undefined && entries.some((entry) => entry.identity === identityOf(target))) continue;

        // The distinct declared hrefs for this language, in document order: the fix hint's target when there is exactly one.
        const hrefs: string[] = [];
        for (const entry of entries ?? []) if (!hrefs.includes(entry.href)) hrefs.push(entry.href);

        const landing = describeLanding(site, page, link, target);
        const message =
          entries === undefined
            ? `This page's hreflang="${link.lang}" switcher ${landing}, but the page declares no hreflang="${link.key}" alternate, so nothing here says which page serves that language.`
            : `This page's hreflang="${link.lang}" switcher ${landing}, but the page declares ${hrefs.map((href) => `href="${href}"`).join(" or ")} as its hreflang="${link.key}" ${hrefs.length > 1 ? "alternates" : "alternate"}.`;

        // The edit is offered only when this page names exactly one alternate for the language; where the source
        // anchors are ambiguous, replaceAttribute declines and the hint falls back to manual. Never a guess.
        const edit = hrefs.length === 1 ? replaceAttribute(page, link.element, "href", hrefs[0]!) : undefined;
        const summary =
          entries === undefined
            ? `Give this page an alternate for ${link.key}: declare <link rel="alternate" hreflang="${link.key}" href="..."> for its ${link.key} translation in the source that emits the hreflang set, or point the switcher at a language this page does declare.`
            : hrefs.length > 1
              ? `This page declares ${hrefs.length} different hreflang="${link.key}" alternates (${hrefs.join(", ")}): keep the correct one in the source that emits the hreflang set, then point this switcher at that page.`
              : `Point the switcher at ${hrefs[0]}, the hreflang="${link.key}" alternate this page declares, or fix the declaration and the page it names if the switcher is the one that is right. Change the source template that emits this link, not only the built file.`;

        out.push({
          message,
          location: locate(page, link.element, "href"),
          fix: { kind: edit ? "edit" : "manual", summary, edits: edit ? [edit] : [] },
          key: `switcher:${link.key}:${link.href.trim()}`,
        });
      }
    }
    return out;
  },
);
