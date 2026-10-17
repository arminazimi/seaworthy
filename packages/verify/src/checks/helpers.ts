// Shared building blocks for checks: locations, text-anchored edits, and element text.

import { type HtmlElement, type Page, attr, positionOf } from "../site.js";
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

/** A replace edit, only when `find` is on that line of the source; otherwise undefined, never a guess. */
export function replaceEdit(page: Page, line: number | undefined, find: string, replace: string, needsInput = false): Edit | undefined {
  if (line === undefined || find === "") return undefined;
  const text = lineText(page, line);
  if (text === undefined || !text.includes(find)) return undefined;
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
