// i18n.parity: every page of an hreflang set exists in every language the set declares, or is listed as untranslated.

import { type Page, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, documentLocation, firstElement, meta, pagesOf } from "./helpers.js";

const ALTERNATE = /(^|\s)alternate(\s|$)/i;
/** The fallback declaration: not a language, so it never joins a cluster and never needs one. */
const X_DEFAULT = "x-default";

interface AlternateLink {
  /** The normalized `hreflang` key: trimmed, lower-cased. Language matching ignores case, as the spec requires. */
  key: string;
  href: string;
}

/**
 * The `rel="alternate" hreflang=...` link elements of a page, in document order, `x-default` entries included.
 * An entry without an `href` declares nothing usable and is left out, exactly as `i18n.hreflang` leaves it out.
 * This scan is the sibling checks' (`i18n.ts`, `i18n-x-default.ts`), copied on purpose: those modules stay
 * untouched so parallel work on them cannot collide.
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

/** The page's own language, from `<html lang>`, normalized; undefined when the page declares none. */
function pageLang(page: Page): string | undefined {
  const html = firstElement(page, "html");
  const lang = html ? attr(html, "lang")?.trim().toLowerCase() : undefined;
  return lang === "" ? undefined : lang;
}

/** Page paths under `untranslated` match `Location.file`, so a URL-style entry's leading slash is dropped. */
function normPath(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

/**
 * The site's declaration of intentionally untranslated pages, from the check's `untranslated` option: a language
 * code mapped to a list of site-relative page paths. Degrades exactly like `quality.page-weight`'s `budgets`:
 * a value that is not an object turns the option off, an entry whose list is not an array is ignored, a non-string
 * inside a list is skipped, and an unknown language is simply never referenced. Nothing is rejected and reported:
 * the config layer owns config errors, and an unusable option must never widen or narrow the findings silently.
 */
function untranslatedOf(options: Readonly<Record<string, unknown>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const raw = options.untranslated;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    const paths = new Set<string>();
    for (const entry of value) {
      const path = typeof entry === "string" ? normPath(entry) : "";
      if (path !== "") paths.add(path);
    }
    out.set(key.trim().toLowerCase(), paths);
  }
  return out;
}

export const i18nParity = check(
  meta("i18n.parity", "an hreflang set declares a language none of its pages serves, and the page is not listed as untranslated", "warning", ["Google rel=alternate hreflang"]),
  (ctx) => {
    const { site } = ctx;
    const untranslated = untranslatedOf(ctx.options);
    const declarations = pagesOf(ctx).map((page) => ({ page, alternates: alternatesOf(page) }));

    // Alternate clusters from the hreflang graph, the way the sibling checks read it: a page takes part when it
    // declares a language alternate itself, or when another page's language alternate resolves to it in this
    // build. `x-default` entries name a fallback page, not a translation, so they neither join a cluster nor
    // count as a language. Union-find merges pages into one cluster per connected component.
    const parent = new Map<string, string>();
    const members = new Set<string>();
    const ensure = (url: string): void => {
      if (!parent.has(url)) parent.set(url, url);
    };
    const find = (url: string): string => {
      let root = url;
      while (parent.get(root) !== root) root = parent.get(root)!;
      while (parent.get(url) !== root) {
        const next = parent.get(url)!;
        parent.set(url, root);
        url = next;
      }
      return root;
    };
    const union = (a: string, b: string): void => {
      ensure(a);
      ensure(b);
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      // Keep the smaller url as the root so the tree shape never depends on union order.
      if (ra < rb) parent.set(rb, ra);
      else parent.set(ra, rb);
    };

    for (const { page, alternates } of declarations) {
      for (const alternate of alternates) {
        if (alternate.key === X_DEFAULT) continue;
        members.add(page.url);
        const target = site.resolveLink(page.url, alternate.href);
        if (target.kind !== "internal" || target.file === undefined) continue;
        const destination = site.pages.get(target.file);
        if (destination === undefined) continue;
        union(page.url, destination.url);
        members.add(destination.url);
      }
    }

    // Group by component. Component order is the sorted first member file, language order is sorted,
    // so the report never depends on Set or Map insertion luck.
    const components = new Map<string, Page[]>();
    for (const url of members) {
      const page = site.pages.get(url);
      if (page === undefined) continue;
      const root = parent.has(url) ? find(url) : url;
      const list = components.get(root);
      if (list) list.push(page);
      else components.set(root, [page]);
    }

    const out: FindingDraft[] = [];
    const sorted = [...components.values()].sort((a, b) => {
      const fa = [...a].map((p) => p.file).sort()[0]!;
      const fb = [...b].map((p) => p.file).sort()[0]!;
      return fa < fb ? -1 : fa > fb ? 1 : 0;
    });
    for (const component of sorted) {
      const pages = [...component].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
      const files = pages.map((page) => page.file);

      // What the set declares, what its pages serve inside this build, and what it declares elsewhere:
      // a language whose only entries point outside this build is the site saying the translation lives on
      // another host. Seaworthy verifies built output offline, so such a language is never demanded here.
      const declared = new Set<string>();
      const served = new Set<string>();
      const offsite = new Set<string>();
      for (const page of pages) {
        const own = pageLang(page);
        if (own !== undefined) served.add(own);
        for (const alternate of alternatesOf(page)) {
          if (alternate.key === X_DEFAULT) continue;
          declared.add(alternate.key);
          const target = site.resolveLink(page.url, alternate.href);
          if (target.kind === "external") offsite.add(alternate.key);
          else if (target.kind === "internal" && target.file === page.url) served.add(alternate.key);
        }
      }

      const declaredLanguages = [...declared].sort();
      for (const language of declaredLanguages) {
        if (served.has(language) || offsite.has(language)) continue;
        // "or is listed as untranslated": naming any page of the set under this language opts the pair out,
        // silently — the site said so on purpose.
        const paths = untranslated.get(language);
        if (paths !== undefined && files.some((file) => paths.has(file))) continue;

        // Report at the first page (sorted) that actually declares this language: it is the one promising
        // a translation the set does not serve.
        const reporter = pages.find((page) => alternatesOf(page).some((alternate) => alternate.key === language))!;
        out.push({
          message: `The hreflang set of ${files.join(", ")} declares the language "${language}", but no page of the set serves it: these pages have no "${language}" version.`,
          location: documentLocation(reporter),
          fix: {
            kind: "manual",
            summary: `Create the "${language}" version of this page and add it to the set (hreflang="${language}" on every member, and back-links from the new page), or, if the page stays untranslated on purpose, list it under checks."i18n.parity".options.untranslated, for example { "${language}": ["${files[0]}"] }.`,
            edits: [],
          },
          key: `parity:${language}:${files.join(" ")}`,
        });
      }
    }
    return out;
  },
);
