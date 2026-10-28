// meta.*: the document-level tags every page needs: title, description, language, viewport, canonical URL.

import { type Page, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
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
