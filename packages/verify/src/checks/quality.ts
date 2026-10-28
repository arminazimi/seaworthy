// quality.empty-pages: a page whose main content area has no text at all — an agent that reads its HTML gets nothing but the site frame.

import { type HtmlElement, type Page, attr } from "../site.js";
import type { Check, FindingDraft } from "../types.js";

import { check, firstElement, isHidden, isRedirectStub, locate, meta, pagesOf } from "./helpers.js";
import { clientShell } from "./readability.js";

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
