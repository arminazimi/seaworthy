// meta.*: the document-level tags every page needs: title, description, language, viewport, canonical URL.

import { type HtmlElement, type Page, type SiteGraph, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, documentLocation, firstElement, insertInHead, isRedirectStub, locate, meta, metaTags, pagesOf, refreshOf, replaceEdit, textOf } from "./helpers.js";

const LANG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export const metaTitle = check(meta("meta.title", "Page has no title", "error", ["WCAG 2.4.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const title = firstElement(page, "title");
    if (title && textOf(title) !== "") continue;
    const edit = title ? undefined : insertInHead(page, "<title>Page title</title>");
    out.push({
      message: title ? "The <title> is empty." : "The page has no <title>.",
      location: title ? locate(page, title) : documentLocation(page),
      fix: { kind: edit ? "edit" : "manual", summary: "Give the page a short title that says what it is. It appears in browser tabs, search results, and screen reader announcements.", edits: edit ? [edit] : [] },
      key: "title",
    });
  }
  return out;
});

// The same title on several pages: grouped across the site, so a template that repeats one title
// reports once, not once per page.
const DUPLICATE_TITLE_PAGE_CAP = 5;

export const metaDuplicateTitles = check(meta("meta.duplicate-titles", "The same title on several pages", "warning"), (ctx) => {
  const byTitle = new Map<string, Page[]>();
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const title = firstElement(page, "title");
    const text = title ? textOf(title) : "";
    // Missing and empty titles are meta.title findings; only pages that have a title can duplicate one.
    if (title === undefined || text === "") continue;
    byTitle.set(text, [...(byTitle.get(text) ?? []), page]);
  }
  const out: FindingDraft[] = [];
  for (const [title, pages] of [...byTitle].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (pages.length < 2) continue;
    const sorted = pages.slice().sort((a, b) => (a.url < b.url ? -1 : 1));
    const listed = sorted.slice(0, DUPLICATE_TITLE_PAGE_CAP).map((p) => p.url);
    const rest = sorted.length - listed.length;
    const list = `${listed.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
    out.push({
      message: `The title "${title}" appears on ${sorted.length} pages (${list}); every page should have a title that says what it is.`,
      location: documentLocation(sorted[0] as Page),
      fix: { kind: "manual", summary: "Give each page a title of its own: the page's name first, then the site name, for example \"Install the CLI | Seaworthy\". Titles usually come from the layout or front matter that produces the page; the same title on every page often means a missing page name there.", edits: [] },
      key: title,
    });
  }
  return out;
});

export const metaDescription = check(meta("meta.description", "Page has no meta description", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const tag = metaTags(page).get("description");
    if (tag && tag.content !== "") continue;
    const edit = tag ? undefined : insertInHead(page, '<meta name="description" content="One sentence about this page.">');
    out.push({
      message: tag ? 'The <meta name="description"> is empty.' : "The page has no meta description.",
      location: tag ? locate(page, tag.element) : documentLocation(page),
      fix: { kind: edit ? "edit" : "manual", summary: "Add a one-sentence description. Search engines and link previews show it.", edits: edit ? [edit] : [] },
      key: "description",
    });
  }
  return out;
});

/** Pages listed in one finding, so a site with one description everywhere stays one line. */
const MAX_GROUP_PAGES = 5;
/** The description quoted in the message, so an accidental paragraph does not swallow the report. */
const MAX_DESCRIPTION_CHARS = 80;

/** Comma-plus-`and` list; when more than `max` pages, the list is capped and the rest are counted. */
function pageList(urls: string[], max: number): string {
  const extra = urls.length - max;
  if (extra > 0) return `${urls.slice(0, max).join(", ")}, and ${extra} more`;
  const shown = urls.length > 1 ? `${urls.slice(0, -1).join(", ")} and ${urls[urls.length - 1] as string}` : (urls[0] as string);
  return shown;
}

export const metaDuplicateDescription = check(meta("meta.duplicate-description", "Pages share the same meta description", "warning"), (ctx) => {
  // Group by the description with whitespace collapsed: spacing does not make two descriptions different.
  const groups = new Map<string, Page[]>();
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const tag = metaTags(page).get("description");
    if (!tag || tag.content === "") continue;
    const description = tag.content.replace(/\s+/g, " ").trim();
    const group = groups.get(description);
    if (group) group.push(page);
    else groups.set(description, [page]);
  }
  const out: FindingDraft[] = [];
  for (const [description, group] of groups) {
    if (group.length < 2) continue;
    // Pages arrive in sorted file order, so the first page is the one the report lists the finding under.
    const first = group[0]!;
    const tag = metaTags(first).get("description")!;
    const quoted = description.length > MAX_DESCRIPTION_CHARS ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}…` : description;
    out.push({
      message: `The meta description "${quoted}" is the same on ${group.length} pages: ${pageList(group.map((page) => page.url), MAX_GROUP_PAGES)}. Search engines show the same preview for all of them.`,
      location: locate(first, tag.element, "content"),
      fix: { kind: "manual", summary: "Write a one-sentence description that says what each page is about, in its <meta name=\"description\">. Reusing one text gives every page the same search-result preview.", edits: [] },
      key: description,
    });
  }
  return out;
});

export const metaLang = check(meta("meta.lang", "Page does not declare its language", "error", ["WCAG 3.1.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const html = firstElement(page, "html");
    const lang = html ? attr(html, "lang")?.trim() : undefined;
    if (lang !== undefined && lang !== "" && LANG.test(lang)) continue;
    const location = html ? locate(page, html, lang === undefined ? undefined : "lang") : { file: page.file };
    const edit = html && lang === undefined ? replaceEdit(page, location.line, "<html", '<html lang="en"', true) : undefined;
    out.push({
      message: lang === undefined || lang === "" ? "The <html> element has no lang attribute." : `The lang value "${lang}" is not a valid language code.`,
      location,
      fix: { kind: edit ? "edit" : "manual", summary: 'Set lang on <html> to the language of the page, such as lang="en". Screen readers choose their voice and pronunciation from it.', edits: edit ? [edit] : [] },
      key: "lang",
    });
  }
  return out;
});

export const metaViewport = check(meta("meta.viewport", "Page has no responsive viewport, or blocks zoom", "warning", ["WCAG 1.4.4"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const tag = metaTags(page).get("viewport");
    if (!tag) {
      const edit = insertInHead(page, '<meta name="viewport" content="width=device-width, initial-scale=1">');
      out.push({
        message: "The page has no viewport meta tag, so phones show it zoomed out as a desktop page.",
        location: documentLocation(page),
        fix: { kind: edit ? "edit" : "manual", summary: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', edits: edit ? [edit] : [] },
        key: "viewport",
      });
      continue;
    }
    const content = tag.content.toLowerCase().replace(/\s+/g, "");
    const maximum = /maximum-scale=([\d.]+)/.exec(content)?.[1];
    if (/user-scalable=(no|0)/.test(content) || (maximum !== undefined && Number(maximum) < 2)) {
      out.push({
        message: "The viewport tag stops people from zooming.",
        location: locate(page, tag.element, "content"),
        fix: { kind: "manual", summary: "Remove user-scalable=no and maximum-scale below 2 from the viewport tag. People with low vision need to zoom.", edits: [] },
        key: "viewport-zoom",
      });
    }
  }
  return out;
});

export const metaCanonical = check(meta("meta.canonical", "Page has no usable canonical URL", "note"), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const link = page.elements.find((e) => e.tagName === "link" && (attr(e, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
    if (!link) {
      const edit = insertInHead(page, `<link rel="canonical" href="https://example.com/${page.file}">`);
      out.push({
        message: "The page has no canonical link.",
        location: documentLocation(page),
        fix: { kind: edit ? "edit" : "manual", summary: "Add <link rel=\"canonical\" href=\"...\"> with the page's full public URL, so search engines know which address to list.", edits: edit ? [edit] : [] },
        key: "canonical",
      });
      continue;
    }
    const href = (attr(link, "href") ?? "").trim();
    if (!/^https?:\/\//i.test(href)) {
      out.push({
        message: href === "" ? "The canonical link has no href." : `The canonical link ${href} is not an absolute URL.`,
        location: locate(page, link, "href"),
        severity: "warning",
        fix: { kind: "manual", summary: "Use the full public URL, starting with https://. Search engines ignore relative canonical links.", edits: [] },
        key: "canonical-relative",
      });
    }
  }
  return out;
});

export const htmlMetaRefresh = check(meta("html.meta-refresh", "Page moves itself after a delay", "warning", ["WCAG 2.2.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (element.tagName !== "meta" || (attr(element, "http-equiv") ?? "").trim().toLowerCase() !== "refresh") continue;
      const content = attr(element, "content") ?? "";
      const refresh = refreshOf(content);
      if (!refresh || refresh.delay === 0) continue;
      const seconds = refresh.delay === 1 ? "1 second" : `${refresh.delay} seconds`;
      const action = refresh.url === "" ? "reloads itself" : `redirects to ${refresh.url}`;
      out.push({
        message: `The page ${action} after ${seconds}, before people can read it.`,
        location: locate(page, element, "content"),
        fix: { kind: "manual", summary: 'Remove the timed refresh and link to the destination so people can choose when to move. If this page only redirects, use an immediate redirect (content="0; url=...") or a server-side redirect.', edits: [] },
        key: `refresh:${content.trim()}`,
      });
    }
  }
  return out;
});

// The first canonical link on a page is the one that applies (HTML canonical rule).
interface Canonical {
  link: HtmlElement;
  href: string;
}

function canonicalOf(page: Page): Canonical | undefined {
  const link = page.elements.find((e) => e.tagName === "link" && (attr(e, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  if (!link) return undefined;
  return { link, href: (attr(link, "href") ?? "").trim() };
}

/** The root-relative URL path a canonical link names, resolved the way a static host serves it; undefined when it names nothing this site graph can check. */
function canonicalTargetOf(site: SiteGraph, page: Page, href: string): { path: string; file: string | undefined } | undefined {
  // An absolute canonical names another deployment, whose origin cannot be verified offline; only its path can.
  let path: string | undefined = href;
  if (/^https?:\/\//i.test(href)) {
    try {
      path = new URL(href).pathname;
    } catch {
      return undefined;
    }
  }
  if (path === undefined || path === "") return undefined;
  // resolveLink strips the configured base path the way links.internal does, for both absolute and relative paths.
  const target = site.resolveLink(page.url, path);
  if (target.kind !== "internal") return undefined;
  return { path: target.path, file: target.file };
}

const FIX_CANONICAL = "Point the canonical at the full public URL of the page's content: its own URL, unless this page is a duplicate of another, in which case use that page's URL.";

const FIX_CYCLE = "Point each page's canonical at the one real address of the content — usually the page's own URL — so the chain ends at a page instead of at another canonical.";

export const metaCanonicalTarget = check(meta("meta.canonical-target", "Canonical link points at a page that does not exist", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const canonical = canonicalOf(page);
    if (!canonical) continue;
    const target = canonicalTargetOf(ctx.site, page, canonical.href);
    // The canonical names a page in the built site; an address that resolves to no page cannot be canonicalized.
    if (target === undefined || (target.file !== undefined && ctx.site.pages.has(target.file))) continue;
    out.push({
      message: `The canonical link ${canonical.href} points at ${target.path}, which is not a page in the built site.`,
      location: locate(page, canonical.link, "href"),
      fix: { kind: "manual", summary: FIX_CANONICAL, edits: [] },
      key: canonical.href,
    });
  }
  return out;
});

export const metaCanonicalCycle = check(meta("meta.canonical-cycle", "Canonical links point at each other in a circle", "warning"), (ctx) => {
  const out: FindingDraft[] = [];
  const edges = new Map<string, { page: Page; link: HtmlElement; href: string; target: string }>();
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const canonical = canonicalOf(page);
    if (!canonical) continue;
    const target = canonicalTargetOf(ctx.site, page, canonical.href);
    if (target === undefined || target.file === undefined || !ctx.site.pages.has(target.file)) continue;
    edges.set(page.url, { page, link: canonical.link, href: canonical.href, target: target.file });
  }

  // Follow every canonical chain once (pages sorted, so runs are deterministic). A cycle is found where a
  // walk re-enters the chain it is walking; each member of a circle is named once, on its own canonical link.
  const color = new Map<string, "walking" | "done">();
  for (const start of [...ctx.site.pages.keys()].sort()) {
    if (color.has(start) || !edges.has(start)) continue;
    const chain: string[] = [];
    let node: string | undefined = start;
    while (node !== undefined && !color.has(node)) {
      color.set(node, "walking");
      chain.push(node);
      node = edges.get(node)?.target; // a page without a canonical ends the chain
    }
    if (node !== undefined && color.get(node) === "walking") {
      const circle = chain.slice(chain.indexOf(node!));
      if (circle.length > 1) {
        // A page whose canonical points at itself is a normal self-canonical, not a circle.
        const loop = [...circle, node!].join(" → ");
        for (const member of circle) {
          const edge = edges.get(member)!;
          out.push({
            message: `The canonical link ${edge.href} helps form a circle of canonical links (${loop}), so none of these pages has a canonical URL search engines can use.`,
            location: locate(edge.page, edge.link, "href"),
            fix: { kind: "manual", summary: FIX_CYCLE, edits: [] },
            key: `circle:${loop}`,
          });
        }
      }
    }
    for (const walked of chain) color.set(walked, "done");
  }
  return out;
});
