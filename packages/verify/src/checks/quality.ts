// quality.orphans: pages of the built site that no other page links to.
// quality.not-found-page: the build ships a real 404 page.
// quality.empty-pages: a page whose main content area has no text at all — an agent that reads its HTML gets nothing but the site frame.
// quality.page-weight: how many bytes one page loads per asset kind (HTML, CSS, JavaScript, images, fonts), against a budget.

import { type HtmlElement, type Page, type SiteGraph, attr } from "../site.js";
import type { Check, FindingDraft, Location } from "../types.js";
import { ancestors, check, documentLocation, firstElement, isHidden, isRedirectStub, locate, meta, pagesOf, readSiteFile, visibleTextOf } from "./helpers.js";
import { positionIn } from "./files.js";
import { kb } from "./images.js";
import { srcsetUrls } from "./assets.js";
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

// ---- quality.page-weight -------------------------------------------------------------------------------------

/** The asset kinds one page pays for, each with its own budget. */
const WEIGHT_BUCKETS = ["html", "css", "javascript", "images", "fonts"] as const;
type WeightBucket = (typeof WEIGHT_BUCKETS)[number];

const WEIGHT_LABEL: Record<WeightBucket, string> = { html: "HTML", css: "CSS", javascript: "JavaScript", images: "images", fonts: "fonts" };

/**
 * Practical budgets, in bytes, applied when the user opted into the check with `budgets` and left a bucket unset —
 * about 1 MB per page in total. Sizes come from the file system, never a browser or the network.
 */
const DEFAULT_BUDGETS: Record<WeightBucket, number> = { html: 50_000, css: 100_000, javascript: 200_000, images: 512_000, fonts: 200_000 };

const WEIGHT_FIXES: Record<WeightBucket, string> = {
  html: "Compress and minify the built HTML, and remove markup the page does not need; put long repeated content on linked pages.",
  css: "Compress or inline only the CSS the page needs: minify it, remove rules the page does not use, or split off deferred styles.",
  javascript: "Compress and minify the script, bundle with tree-shaking, defer or remove anything the page does not run on load.",
  images: "Compress or resize the images to the size they are shown at, serve WebP or AVIF, or remove images that are not shown.",
  fonts: "Compress the fonts (WOFF2 is smallest), subset them to the glyphs the page uses, drop unused weights, or lean on system fonts.",
};

/** One loaded asset: its size, the exact position where it is attributable, and how a message names it. */
interface Loaded {
  bytes: number;
  where: Location;
  note: string;
}

/** One bucket's weights: seen identities so a file two elements load counts once, and the sum of the loads. */
interface Weighed {
  seen: Set<string>;
  loads: Loaded[];
  total: number;
}

const newWeigh = (): Weighed => ({ seen: new Set(), loads: [], total: 0 });

const FONT_EXTENSION = /\.(woff2?|ttf|otf|eot)$/i;
/** A `url(...)` in CSS text; the quote, when there is one, is captured so it must close. */
const CSS_URL = /url\(\s*(['"]?)([^'()]+)\1\s*\)/g;
/** Script `type` values a browser executes as JavaScript; anything else (import maps, JSON-LD, data) is not. */
const JS_TYPES = /^(text\/javascript|application\/(x-)?(java|ecma)script|module)$/i;

/**
 * Per-bucket budgets from the check's `budgets` option, or undefined when the check is off: no
 * `budgets` object in the options means no findings, so built output and reports are byte-identical
 * with and without the feature until a site opts in. Buckets the object leaves unset use the
 * defaults, and a budget that is not a finite non-negative number falls back to its default too.
 */
function budgetsOf(options: Readonly<Record<string, unknown>>): Record<WeightBucket, number> | undefined {
  const raw = options.budgets;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const budgets = { ...DEFAULT_BUDGETS };
  for (const bucket of WEIGHT_BUCKETS) {
    const value = (raw as Record<string, unknown>)[bucket];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) budgets[bucket] = value;
  }
  return budgets;
}

/** The exact bytes of inline script or style content: from the source when the parser gives positions, else its text nodes. */
function inlineSource(page: Page, element: HtmlElement): string {
  const tag = element.sourceCodeLocation;
  if (tag?.startTag && tag.endTag) return page.source.slice(tag.startTag.endOffset, tag.endTag.startOffset);
  let text = "";
  for (const child of element.childNodes as { nodeName: string; value?: string }[]) if (child.nodeName === "#text" && child.value) text += child.value;
  return text;
}

export const qualityPageWeight = check(meta("quality.page-weight", "Page carries more than its per-asset-kind weight budget", "warning"), (ctx) => {
  const budgets = budgetsOf(ctx.options);
  if (budgets === undefined) return [];
  const { site } = ctx;
  const files = new Map<string, { bytes: Buffer; size: number } | undefined>();
  const readFile = (urlPath: string): { bytes: Buffer; size: number } | undefined => {
    if (!files.has(urlPath)) files.set(urlPath, readSiteFile(site, urlPath));
    return files.get(urlPath);
  };
  const out: FindingDraft[] = [];

  for (const page of pagesOf(ctx)) {
    const buckets: Record<WeightBucket, Weighed> = { html: newWeigh(), css: newWeigh(), javascript: newWeigh(), images: newWeigh(), fonts: newWeigh() };
    const stylesheets: string[] = [];

    /** Counts one asset once per page, keyed by identity: a file path, or a data URI's text. */
    const count = (weigh: Weighed, identity: string, load: () => Loaded | undefined): void => {
      if (weigh.seen.has(identity)) return;
      weigh.seen.add(identity);
      const one = load();
      if (!one) return;
      weigh.loads.push(one);
      weigh.total += one.bytes;
    };
    const countFile = (weigh: Weighed, urlPath: string, where: Location): void =>
      count(weigh, urlPath, () => {
        const file = readFile(urlPath);
        return file ? { bytes: file.size, where, note: urlPath } : undefined;
      });
    /** A data URI's bytes travel with the page even without a file: counted as its own inline asset. */
    const countUri = (weigh: Weighed, uri: string, where: Location): void =>
      count(weigh, uri, () => ({ bytes: Buffer.byteLength(uri, "utf8"), where, note: "a data URI" }));
    /** Files and data URIs share the counting; external URLs (CDNs and the like) are not this build's weight. */
    const gather = (weigh: Weighed, fromUrl: string, url: string, where: Location): void => {
      if (/^data:/i.test(url)) countUri(weigh, url, where);
      else {
        const target = site.resolveLink(fromUrl, url);
        if (target.kind === "internal" && target.file !== undefined) countFile(weigh, target.file, where);
      }
    };
    const inline = (weigh: Weighed, note: string, element: HtmlElement): void => {
      const text = inlineSource(page, element);
      if (text.trim() === "") return;
      weigh.loads.push({ bytes: Buffer.byteLength(text, "utf8"), where: locate(page, element), note });
      weigh.total += Buffer.byteLength(text, "utf8");
    };

    for (const element of page.elements) {
      switch (element.tagName) {
        case "link": {
          const href = attr(element, "href");
          if (!href) continue;
          const rels = (attr(element, "rel") ?? "").toLowerCase().split(/\s+/);
          const as = (attr(element, "as") ?? "").toLowerCase();
          const bucket = rels.includes("stylesheet")
            ? ("css" as const)
            : rels.includes("modulepreload") && as !== "style" ? ("javascript" as const)
            : rels.includes("preload")
              ? ({ style: "css", worker: "javascript", script: "javascript", image: "images", font: "fonts", fetch: undefined } as Record<string, WeightBucket | undefined>)[as]
              : undefined;
          if (!bucket) continue;
          gather(buckets[bucket], page.url, href, locate(page, element, "href"));
          if (bucket === "css") {
            const target = site.resolveLink(page.url, href);
            if (target.kind === "internal" && target.file !== undefined && !stylesheets.includes(target.file)) stylesheets.push(target.file);
          }
          continue;
        }
        case "style":
          inline(buckets.css, "an inline <style> block", element);
          continue;
        case "script": {
          const type = (attr(element, "type") ?? "").trim();
          if (type !== "" && !JS_TYPES.test(type)) continue;
          const src = attr(element, "src");
          if (src) gather(buckets.javascript, page.url, src, locate(page, element, "src"));
          else inline(buckets.javascript, "an inline <script>", element);
          continue;
        }
        case "img":
        case "source": {
          // A <source> only serves an image when its parent is a <picture>; outside one it serves media.
          if (element.tagName === "source" && ancestors(element)[0]?.tagName !== "picture") continue;
          for (const attribute of ["src", "srcset"] as const) {
            const value = attr(element, attribute);
            if (value === undefined) continue;
            for (const url of attribute === "srcset" ? srcsetUrls(value) : [value]) gather(buckets.images, page.url, url, locate(page, element, attribute));
          }
          continue;
        }
        case "video": {
          const poster = attr(element, "poster");
          if (poster !== undefined) gather(buckets.images, page.url, poster, locate(page, element, "poster"));
          continue;
        }
        default:
          continue;
      }
    }

    // The HTML itself: the page's own file, sized from the build output.
    const pageFile = readFile(page.url);
    buckets.html.loads.push({ bytes: pageFile?.size ?? Buffer.byteLength(page.source, "utf8"), where: { file: page.file }, note: "the page itself" });
    buckets.html.total = pageFile?.size ?? Buffer.byteLength(page.source, "utf8");

    // Fonts a page loads usually live in `@font-face src` lines inside its stylesheets, not in the HTML.
    for (const urlPath of stylesheets) {
      const file = readFile(urlPath);
      if (!file) continue;
      const css = file.bytes.toString("utf8");
      for (const match of css.matchAll(CSS_URL)) {
        const url = match[2] ?? "";
        if (!/^data:/i.test(url) && !FONT_EXTENSION.test(url.split(/[?#]/)[0] ?? "")) continue;
        const where: Location = { file: urlPath, ...positionIn(css, match.index ?? 0), approximateLine: true };
        gather(buckets.fonts, urlPath, url, where);
      }
    }

    for (const bucket of WEIGHT_BUCKETS) {
      const weighed = buckets[bucket];
      const budget = budgets[bucket];
      if (weighed.total <= budget) continue;
      const heaviest = weighed.loads.reduce((a, b) => (b.bytes > a.bytes ? b : a));
      out.push({
        message:
          bucket === "html"
            ? `${page.file} measures ${kb(weighed.total)} of HTML, ${kb(weighed.total - budget)} over the ${kb(budget)} budget.`
            : `${page.file} loads ${kb(weighed.total)} of ${WEIGHT_LABEL[bucket]}, ${kb(weighed.total - budget)} over the ${kb(budget)} budget; its heaviest asset is ${heaviest.note} at ${kb(heaviest.bytes)}.`,
        location: bucket === "html" ? { file: page.file } : heaviest.where,
        fix: { kind: "manual", summary: WEIGHT_FIXES[bucket], edits: [] },
        key: bucket,
      });
    }
  }
  return out;
});
