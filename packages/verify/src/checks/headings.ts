// headings.*: the outline of a page: one h1, and no skipped levels.

import { type HtmlElement, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, isRedirectStub, locate, meta, pagesOf, textOf } from "./helpers.js";

const LEVEL = /^h([1-6])$/;
const isHidden = (e: HtmlElement): boolean => attr(e, "hidden") !== undefined || attr(e, "aria-hidden")?.toLowerCase() === "true";

export const headingsH1 = check(meta("headings.h1", "Page does not have exactly one h1", "warning", ["WCAG 1.3.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    const h1s = page.elements.filter((e) => e.tagName === "h1" && !isHidden(e));
    if (h1s.length === 1) continue;
    const second = h1s[1];
    out.push({
      message: h1s.length === 0 ? "The page has no h1 heading." : `The page has ${h1s.length} h1 headings; it should have one.`,
      location: second ? locate(page, second) : { file: page.file },
      fix: {
        kind: "manual",
        summary: h1s.length === 0 ? "Add one h1 that names the page. Screen reader users jump to it to find the main content." : "Keep one h1 for the page title and make the others h2 or lower.",
        edits: [],
      },
      key: h1s.length === 0 ? "h1-missing" : "h1-multiple",
    });
  }
  return out;
});

export const headingsOrder = check(meta("headings.order", "Heading levels skip a level", "warning", ["WCAG 1.3.1"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    if (isRedirectStub(page)) continue;
    let previous = 0;
    for (const element of page.elements) {
      const level = Number(LEVEL.exec(element.tagName)?.[1]);
      if (!level || isHidden(element)) continue;
      if (previous > 0 && level > previous + 1) {
        const text = textOf(element).slice(0, 60);
        out.push({
          message: `A level ${level} heading${text ? ` ("${text}")` : ""} follows a level ${previous} heading, skipping level ${previous + 1}.`,
          location: locate(page, element),
          fix: { kind: "manual", summary: `Make this heading h${previous + 1}, or add the missing h${previous + 1} above it. Headings form an outline that screen readers navigate by level; style size with CSS, not the tag.`, edits: [] },
          key: `${previous}>${level}:${text}`,
        });
      }
      previous = level;
    }
  }
  return out;
});
