// meta.*: the document-level tags every page needs: title, description, language, viewport, canonical URL.

import { attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import type { Page, SiteGraph } from "../site.js";
import { check, documentLocation, firstElement, insertInHead, isRedirectStub, locate, meta, metaTags, pagesOf, replaceEdit, textOf } from "./helpers.js";

const LANG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

// The HTML refresh algorithm: digits, then an optional `;`, `,`, or whitespace separator, then an optional URL.
// `url=` before the URL is only required for conforming markup; without it the whole remainder is the URL.
const ASCII_WHITESPACE = /^[\t\n\f\r ]+/;

/** The delay in seconds from a refresh content value a browser would act on, with its optional URL. */
function refreshOf(content: string): { delay: number; url: string } | undefined {
  const input = content.replace(ASCII_WHITESPACE, "");
  const digits = /^\d+/.exec(input);
  if (!digits) return undefined;
  const delay = Number(digits[0]);
  let rest = input.slice(digits[0].length);

  if (rest !== "") {
    const first = rest[0];
    if (first === ";" || first === ",") rest = rest.slice(1).replace(ASCII_WHITESPACE, "");
    else if (ASCII_WHITESPACE.test(rest)) {
      rest = rest.replace(ASCII_WHITESPACE, "");
      if (rest[0] === ";" || rest[0] === ",") rest = rest.slice(1).replace(ASCII_WHITESPACE, "");
    } else return undefined;
  }

  let url = rest.replace(/[\t\n\f\r ]+$/, "").replace(/^url[\t\n\f\r ]*=/i, "").replace(ASCII_WHITESPACE, "");
  if ((url.startsWith("'") && url.endsWith("'")) || (url.startsWith('"') && url.endsWith('"'))) url = url.slice(1, -1);
  url = url.replace(ASCII_WHITESPACE, "").replace(/[\t\n\f\r ]+$/, "");
  if (/^javascript:/i.test(url)) return undefined;
  return { delay, url };
}

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

// html.redirect-chain: redirect pages whose target redirects again, forming a chain or a loop.

/**
 * The page a browser lands on when it acts on a refresh: the first refresh with a URL, resolved the way
 * internal links are. A refresh that follows the URL outside the site, or to a file that does not exist,
 * is a dead end ("stub"); no refresh with a URL means the page is content.
 */
function redirectEdge(site: SiteGraph, page: Page): Page | "stub" | undefined {
  for (const element of page.elements) {
    if (element.tagName !== "meta" || (attr(element, "http-equiv") ?? "").trim().toLowerCase() !== "refresh") continue;
    const refresh = refreshOf(attr(element, "content") ?? "");
    if (!refresh || refresh.url === "") continue;
    // The walk follows the browser: the first refresh that acts decides where the page lands.
    const target = site.resolveLink(page.url, refresh.url);
    if (target.kind !== "internal" || target.file === undefined) return "stub";
    return site.pages.get(target.file);
  }
  return undefined;
}

const describePath = (path: readonly Page[]): string => path.map((p) => p.url).join(" -> ");

export const htmlRedirectChain = check(meta("html.redirect-chain", "Redirect pages form a chain or a loop", "warning", ["WCAG 2.2.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  const reported = new Set<string>();

  for (const page of pagesOf(ctx)) {
    // Follow the redirects the way a browser does, until a content page (a chain to report), a dead end
    // outside the site (not reported here: missing pages are links.internal's subject), or a page the
    // path already visits (a loop) ends the walk.
    const path: Page[] = [page];
    let cycle: Page[] | undefined;
    let deadEnd = false;
    while (true) {
      const next = redirectEdge(ctx.site, path[path.length - 1]!);
      if (next === undefined) break;
      if (next === "stub") {
        deadEnd = true;
        break;
      }
      const at = path.findIndex((p) => p.url === next.url);
      if (at !== -1) {
        cycle = path.slice(at);
        break;
      }
      path.push(next);
    }

    if (cycle !== undefined) {
      // The same loop is found from every page that walks into it. Name it from its first page in file
      // order so it is reported once, as an error: browsers never land on a content page.
      const ring = [...cycle].sort((a, b) => (a.url < b.url ? -1 : b.url < a.url ? 1 : 0));
      ring.push(ring[0]!);
      const key = `loop${describePath(ring)}`;
      if (!reported.has(key)) {
        reported.add(key);
        const destinations = ring.slice(0, -1).map((p) => p.url).join(" and ");
        out.push({
          message:
            cycle.length === 1
              ? `The page redirects to itself: ${describePath(ring)}. Browsers reload it endlessly and never arrive anywhere.`
              : `The page is part of a redirect loop: ${describePath(ring)}. Browsers keep moving between ${cycle.length} pages and never land on content.`,
          location: documentLocation(ring[0]!),
          severity: "error",
          fix: {
            kind: "manual",
            summary:
              cycle.length === 1
                ? "The refresh points the page at itself. Point it at the destination readers should reach, or remove the refresh."
                : `Break the loop: point ${destinations} at real destinations (or remove the refresh tags). A loop has no final page to land on.`,
            edits: [],
          },
          key,
        });
      }
      continue;
    }
    if (deadEnd || path.length < 3) continue; // a single redirect onto a content page is not a chain
    const final = path[path.length - 1]!.url;
    out.push({
      message: `The page starts a chain of redirects: ${describePath(path)}. Readers pass through ${path.length - 1} redirects before reaching content.`,
      location: documentLocation(page),
      fix: {
        kind: "manual",
        summary: `Point each redirect page straight at the final destination ${final}: redirect immediately (content="0; url=${final}") or move the redirect to the server, so readers skip ${path.length - 2} intermediate pages.`,
        edits: [],
      },
      key: `chain${describePath(path)}`,
    });
  }
  return out;
});
