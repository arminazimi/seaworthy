// quality.orphans: pages of the built site that no other page links to.
// quality.not-found-page: the build ships a real 404 page.
// quality.empty-pages: a page whose main content area has no text at all — an agent that reads its HTML gets nothing but the site frame.

import { type HtmlElement, type Page, type SiteGraph, attr } from "../site.js";
import type { Check, FindingDraft } from "../types.js";
import { check, documentLocation, firstElement, isHidden, isRedirectStub, locate, meta, pagesOf, visibleTextOf } from "./helpers.js";
import { clientShell } from "./readability.js";
import { sitemapListedFiles } from "./sitemap.js";

const LINKING = new Set(["a", "area"]);

/** Pages that are reachable without an inbound link, so they never count as orphans. */
function reachableWithoutLinks(site: SiteGraph): ReadonlySet<string> {
  const reachable = new Set<string>();
  for (const url of site.pages.keys()) {
    if (url.endsWith("/index.html") || url === "/404.html") reachable.add(url);
  }
  for (const file of sitemapListedFiles(site)) reachable.add(file);
  return reachable;
}

export const qualityOrphans = check(meta("quality.orphans", "Page that no other page links to", "warning"), (ctx) => {
  const { site } = ctx;
  const linked = new Set<string>();
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (!LINKING.has(element.tagName)) continue;
      const href = attr(element, "href");
      if (href === undefined) continue;
      const target = site.resolveLink(page.url, href);
      // A page linking to itself (for example href="#top") does not make itself reachable.
      if (target.kind === "internal" && target.file !== undefined && target.file !== page.url) linked.add(target.file);
    }
  }

  const exempt = reachableWithoutLinks(site);
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (linked.has(page.url) || exempt.has(page.url)) continue;
    out.push({
      message: `No other page links to ${page.url}, so people and agents can only reach it by guessing the URL.`,
      location: documentLocation(page),
      fix: {
        kind: "manual",
        summary: `Add a link to ${page.url} from a page people already visit (navigation, an index, or inline text), or delete the page if it is no longer needed.`,
        edits: [],
      },
      key: page.url,
    });
  }
  return out;
});

// ---- quality.not-found-page ---------------------------------------------------------------------------------

/** Root-relative paths a static build may use for its not-found page, tried in this order. */
const NOT_FOUND_PATHS = ["/404.html", "/404/index.html"];

export const qualityNotFoundPage = check(meta("quality.not-found-page", "The 404 page is missing or is not a real page", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  const page = notFoundPage(ctx.site);
  if (page === undefined) {
    out.push({
      message: "The build has no 404 page, so a broken address shows the host's default error page, and agents reading the site see a soft 404.",
      location: { file: "404.html" },
      fix: {
        kind: "manual",
        summary: 'Add a not-found page at the site root as 404.html (or 404/index.html). It should say the address was not found and link to the home page and other key pages. Most static generators have a "not found" template. Make it a real page, not a redirect.',
        edits: [],
      },
      key: "missing",
    });
    return out;
  }
  const body = firstElement(page, "body");
  if (isRedirectStub(page)) {
    out.push({
      message: "The 404 page only redirects elsewhere instead of showing a not-found message. Hosts serve it with a 404 status, so a redirect there can loop, and a visitor never learns that the address does not exist.",
      location: documentLocation(page),
      fix: {
        kind: "manual",
        summary: "Replace the redirect with a real page: say the address was not found, and link to the home page and key pages. Keep the site layout so navigation still works.",
        edits: [],
      },
      key: "redirect-stub",
    });
  } else if (body === undefined || visibleTextOf(body) === "") {
    out.push({
      message: "The 404 page has no visible content. A visitor (or an agent) that follows a broken address lands on a blank page with nothing to do.",
      location: documentLocation(page),
      fix: {
        kind: "manual",
        summary: 'Write the not-found message into the page: a heading that says the page does not exist, a short explanation, and links to the home page and key pages.',
        edits: [],
      },
      key: "empty",
    });
  }
  return out;
});

/** The site's not-found page, if the build includes one under a path static hosts and generators use. */
function notFoundPage(site: SiteGraph): Page | undefined {
  for (const path of NOT_FOUND_PATHS) {
    if (!site.files.has(path)) continue;
    const page = site.pages.get(path);
    if (page) return page;
  }
  return undefined;
}

// ---- quality.empty-pages ------------------------------------------------------------------------------------

/** Elements that hold the site frame — shared across pages — rather than this page's content. */
const CHROME = new Set(["nav", "header", "footer", "aside"]);
/** Landmark roles for the site frame, for pages that mark it up with ARIA instead of the elements. */
const CHROME_ROLES = new Set(["banner", "navigation", "contentinfo", "complementary", "search", "menu", "menubar"]);
/** Elements whose text is for machines and build tools, never for a reader. */
const INVISIBLE = new Set(["script", "style", "template", "noscript"]);
/** Elements that show a picture, video, canvas, or embed where text would be: a reader still gets something. */
const SHOWS_CONTENT = new Set(["img", "svg", "picture", "audio", "video", "canvas", "iframe", "embed", "object"]);

/** A parse5 node shape that covers elements, text, comments, and the document type. */
type AnyNode = { nodeName: string; childNodes?: readonly AnyNode[]; value?: string; attrs?: ReadonlyArray<{ name: string; value: string }> };

type NodeAttr = (node: AnyNode, name: string) => string | undefined;
const nodeAttr: NodeAttr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;

/** The page's content container: the first `<main>` (or `role="main"`) that is not hidden, else `<body>`. */
function contentContainer(page: Page): { element: HtmlElement; isMain: boolean } | undefined {
  const main = page.elements.find((e) => (e.tagName === "main" || (attr(e, "role") ?? "").trim().toLowerCase() === "main") && !isHidden(e));
  if (main) return { element: main, isMain: true };
  const body = firstElement(page, "body");
  return body ? { element: body, isMain: false } : undefined;
}

/**
 * The words a reader sees inside the container, in one pass, with hidden subtrees dropped. When `withChrome` is
 * false — no `<main>`, so the container is `<body>` — the site frame (nav, header, footer, aside, and their ARIA
 * equivalents) is dropped too, because that frame is on every page and is not this page's content.
 */
function readableContent(container: HtmlElement, withChrome: boolean): { words: ReadonlySet<string>; showsContent: boolean } {
  const parts: string[] = [];
  let showsContent = false;
  const visit = (node: AnyNode): void => {
    if (node.nodeName === "#text") {
      if (node.value) parts.push(node.value);
      return;
    }
    if (node.nodeName === "#comment" || node.nodeName === "#documentType") return;
    if (isHidden(node as HtmlElement) || INVISIBLE.has(node.nodeName)) return;
    if (SHOWS_CONTENT.has(node.nodeName)) {
      showsContent = true;
      return;
    }
    if (!withChrome && (CHROME.has(node.nodeName) || CHROME_ROLES.has((nodeAttr(node, "role") ?? "").trim().toLowerCase()))) return;
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(container as unknown as AnyNode);
  // Distinct words of four or more letters or digits: the same measure the readability checks use.
  const words = new Set((parts.join(" ").match(/[\p{L}\p{N}]{4,}/gu) ?? []));
  return { words, showsContent };
}

export const qualityEmptyPages = check(meta("quality.empty-pages", "Page has no main text: an agent reading its HTML finds only the site frame", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue; // a page that only redirects is html.meta-refresh's subject
    const container = contentContainer(page);
    if (!container) continue;
    const { words, showsContent } = readableContent(container.element, container.isMain);
    if (words.size > 0) continue; // a tiny page with a few real words of its own — a note, a legal line — is not empty
    if (showsContent) continue; // an image, video, or canvas shows a reader something where the text would be
    if (clientShell(page) !== undefined) continue; // content that only a browser can build is readability.ssr-content's subject
    out.push({
      message: container.isMain
        ? "This page's <main> has no text in it. An agent, crawler, or link preview that reads the HTML without running JavaScript gets nothing from this page but the site's navigation and chrome."
        : "This page has no <main> and, apart from its navigation, header, and footer, no text at all, so an agent that reads the HTML gets nothing from this page but the site frame.",
      location: locate(page, container.element),
      fix: {
        kind: "manual",
        summary: container.isMain
          ? "Serve the page's real content inside <main> as headings and paragraphs that are in the HTML. Keep the header, navigation, and footer outside it."
          : "Add a <main> element holding the page's real content as headings and paragraphs that are in the HTML. Keep the header, navigation, and footer outside it.",
        edits: [],
      },
      key: "no-main-text",
    });
  }
  return out;
});
