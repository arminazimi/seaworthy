// Shared building blocks for checks: locations, text-anchored edits, and element text.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { type HtmlElement, type Page, type SiteGraph, attr, positionOf } from "../site.js";
import type { Check, CheckMeta, Edit, Location } from "../types.js";

export const DOCS_BASE = "https://github.com/arminazimi/seaworthy/blob/main/docs/checks/";

/** Metadata for a check whose docs page is docs/checks/<id>.md. */
export function meta(id: string, title: string, severity: CheckMeta["severity"], standards: readonly string[] = [], needs: CheckMeta["needs"] = ["html"]): CheckMeta {
  return { id, title, severity, needs, docs: `${DOCS_BASE}${id}.md`, standards };
}

export function check(metadata: CheckMeta, run: Check["run"]): Check {
  return { meta: metadata, run };
}

/** Where an element, or one of its attributes, starts. */
export function locate(page: Page, element: HtmlElement, attribute?: string): Location {
  const position = positionOf(element, attribute);
  return position ? { file: page.file, line: position.line, column: position.column } : { file: page.file };
}

export function lineText(page: Page, line: number): string | undefined {
  return page.source.split(/\r?\n/)[line - 1];
}

/** A replace edit, only when `find` is on that line of the source exactly once; otherwise undefined, never a guess. */
export function replaceEdit(page: Page, line: number | undefined, find: string, replace: string, needsInput = false): Edit | undefined {
  if (line === undefined || find === "") return undefined;
  const text = lineText(page, line);
  // The text must occur exactly once on the line, so the edit can never land on a different element.
  if (text === undefined || text.indexOf(find) === -1 || text.indexOf(find) !== text.lastIndexOf(find)) return undefined;
  return { file: page.file, line, action: "replace", find, replace, ...(needsInput ? { needsInput: true } : {}) };
}

/** The raw source text of an element's opening tag, when its position is known. */
export function startTagText(page: Page, element: HtmlElement): string | undefined {
  const tag = element.sourceCodeLocation?.startTag;
  return tag ? page.source.slice(tag.startOffset, tag.endOffset) : undefined;
}

/** All text inside an element, with whitespace collapsed. */
export function textOf(element: HtmlElement): string {
  const parts: string[] = [];
  const visit = (node: { nodeName: string; childNodes?: unknown[]; value?: string }): void => {
    if (node.nodeName === "#text" && node.value) parts.push(node.value);
    for (const child of (node.childNodes ?? []) as (typeof node)[]) visit(child);
  };
  visit(element as unknown as Parameters<typeof visit>[0]);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export const pagesOf = (ctx: { site: { pages: ReadonlyMap<string, Page> } }): Page[] => [...ctx.site.pages.values()];

// ---- page structure helpers --------------------------------------------------------------------------------

export const firstElement = (page: Page, tagName: string): HtmlElement | undefined => page.elements.find((e) => e.tagName === tagName);

/** `<meta name=... content=...>` and `<meta property=... content=...>` values, keyed by name or property (lowercase). */
export function metaTags(page: Page): Map<string, { element: HtmlElement; content: string }> {
  const tags = new Map<string, { element: HtmlElement; content: string }>();
  for (const element of page.elements) {
    if (element.tagName !== "meta") continue;
    const key = (attr(element, "name") ?? attr(element, "property"))?.trim().toLowerCase();
    if (key && !tags.has(key)) tags.set(key, { element, content: (attr(element, "content") ?? "").trim() });
  }
  return tags;
}

/** True for pages that only redirect elsewhere (`<meta http-equiv="refresh">`): they have no content to check. */
export function isRedirectStub(page: Page): boolean {
  return page.elements.some((e) => e.tagName === "meta" && attr(e, "http-equiv")?.toLowerCase() === "refresh");
}

/** An edit that adds text just before `</head>`, when that closing tag is on a line of its own source. */
export function insertInHead(page: Page, text: string): Edit | undefined {
  const head = firstElement(page, "head");
  const end = head?.sourceCodeLocation?.endTag;
  return end ? replaceEdit(page, end.startLine, "</head>", `${text}</head>`, true) : undefined;
}

/** Where to report a problem with the document as a whole: its `<head>`, or `<html>`, or the file. */
export function documentLocation(page: Page): Location {
  const el = firstElement(page, "head") ?? firstElement(page, "html");
  return el ? locate(page, el) : { file: page.file };
}

/** The opening tag text with ` name="value"` added before its closing `>` or `/>`; undefined if the tag spans lines. */
export function withAttribute(tag: string, name: string, value: string): string | undefined {
  if (tag.includes("\n")) return undefined;
  const end = /\s*\/?>$/.exec(tag);
  if (!end) return undefined;
  return `${tag.slice(0, end.index)} ${name}="${value}"${end[0]}`;
}

/** The bytes and size of a site file given its root-relative URL path, or undefined when it is missing. */
export function readSiteFile(site: SiteGraph, urlPath: string): { bytes: Buffer; size: number } | undefined {
  if (!site.files.has(urlPath)) return undefined;
  const path = join(site.root, ...urlPath.slice(1).split("/"));
  try {
    return { bytes: readFileSync(path), size: statSync(path).size };
  } catch {
    return undefined;
  }
}

/** The element's ancestors, nearest first. */
export function ancestors(element: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [];
  let node = element.parentNode as (HtmlElement | null);
  while (node && "tagName" in node) {
    out.push(node);
    node = node.parentNode as HtmlElement | null;
  }
  return out;
}

/** Every element below this one, in document order. */
export function descendants(element: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [];
  const visit = (node: { childNodes?: unknown[] }): void => {
    for (const child of (node.childNodes ?? []) as (HtmlElement & { childNodes?: unknown[] })[]) {
      if ("tagName" in child) out.push(child);
      visit(child);
    }
  };
  visit(element);
  return out;
}

/** True when the element, or anything inside it, is hidden from people and assistive technology. */
export function isHidden(element: HtmlElement): boolean {
  return [element, ...ancestors(element)].some((e) => attr(e, "hidden") !== undefined || attr(e, "aria-hidden")?.trim().toLowerCase() === "true");
}

/** The exact source text of one attribute of an element (for example `src="/a.png"`) and the line it is on. */
function rawAttribute(page: Page, element: HtmlElement, name: string): { text: string; line: number } | undefined {
  const at = element.sourceCodeLocation?.attrs?.[name];
  return at ? { text: page.source.slice(at.startOffset, at.endOffset), line: at.startLine } : undefined;
}

/**
 * An edit that adds attributes to an element by inserting them right after its first existing attribute
 * (or after the tag name when it has none). Anchoring on an attribute that other edits do not change means
 * edits from different checks to the same element still apply in any order.
 */
export function addAttributes(page: Page, element: HtmlElement, additions: Record<string, string>, needsInput = false): Edit | undefined {
  const text = Object.entries(additions).map(([name, value]) => ` ${name}="${value}"`).join("");
  const first = element.attrs[0];
  const raw = first ? rawAttribute(page, element, first.name) : undefined;
  if (raw) return replaceEdit(page, raw.line, raw.text, `${raw.text}${text}`, needsInput);
  const tag = element.sourceCodeLocation?.startTag;
  return tag ? replaceEdit(page, tag.startLine, `<${element.tagName}`, `<${element.tagName}${text}`, needsInput) : undefined;
}

/** An edit that renames an attribute, keeping its value. The new name replaces the exact name as written in the source. */
export function renameAttribute(page: Page, element: HtmlElement, name: string, newName: string): Edit | undefined {
  const raw = rawAttribute(page, element, name);
  if (!raw) return undefined;
  const eq = raw.text.indexOf("=");
  const written = eq < 0 ? raw.text : raw.text.slice(0, eq);
  // Anchor on "name=" so a value that repeats the name cannot be mistaken for it.
  return replaceEdit(page, raw.line, eq < 0 ? written : `${written}=`, eq < 0 ? newName : `${newName}=`);
}

/**
 * An edit that sets an attribute to a new value by replacing the attribute's whole source text, such as
 * `href="/a.html"` to `href="/b.html"`. The old text includes the name and quotes, so it is far more specific
 * than the bare value (which can also appear inside another link). The original quote style is kept.
 */
export function replaceAttribute(page: Page, element: HtmlElement, name: string, value: string): Edit | undefined {
  const raw = rawAttribute(page, element, name);
  const eq = raw?.text.indexOf("=") ?? -1;
  if (!raw || eq < 0) return undefined;
  const quote = raw.text[eq + 1] === "'" ? "'" : '"';
  const escaped = value.replace(/&/g, "&amp;").replace(quote === '"' ? /"/g : /'/g, quote === '"' ? "&quot;" : "&#39;");
  return replaceEdit(page, raw.line, raw.text, `${raw.text.slice(0, eq)}=${quote}${escaped}${quote}`);
}
