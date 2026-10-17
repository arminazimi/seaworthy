// Shared building blocks for checks: locations, text-anchored edits, and element text.

import { type HtmlElement, type Page, positionOf } from "../site.js";
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
