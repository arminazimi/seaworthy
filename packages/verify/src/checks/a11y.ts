// a11y.*: static accessibility rules that need no browser (epic E-a11y-static).

import { attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, descendants, isHidden, locate, meta, pagesOf, replaceAttribute, textOf } from "./helpers.js";

export const a11yTabindex = check(meta("a11y.tabindex", "Element has a positive tabindex, which breaks the focus order", "warning", ["WCAG 2.4.3"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      const raw = attr(element, "tabindex");
      if (raw === undefined || !/^\s*\+?\d+\s*$/.test(raw) || Number.parseInt(raw, 10) <= 0) continue;
      const location = locate(page, element, "tabindex");
      const edit = replaceAttribute(page, element, "tabindex", "0");
      out.push({
        message: `<${element.tagName}> has tabindex="${raw.trim()}". Keyboard focus visits it before everything else on the page, out of reading order.`,
        location,
        fix: {
          kind: edit ? "edit" : "manual",
          summary: 'Use tabindex="0" to make an element focusable in its natural place, or remove tabindex from elements that are focusable already. Fix the order by moving the element in the HTML, not with positive numbers.',
          edits: edit ? [edit] : [],
        },
        key: `${element.tagName}:${attr(element, "id") ?? raw.trim()}:${location.line ?? ""}`,
      });
    }
  }
  return out;
});

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** True when something inside the element gives it a name: text, an image with alt text, or an ARIA label. */
function hasAccessibleContent(element: Parameters<typeof textOf>[0]): boolean {
  if (textOf(element) || (attr(element, "aria-label") ?? "").trim() || (attr(element, "aria-labelledby") ?? "").trim()) return true;
  return descendants(element).some(
    (e) => ((e.tagName === "img" || e.tagName === "input") && (attr(e, "alt") ?? "").trim() !== "") || (attr(e, "aria-label") ?? "").trim() !== "" || (attr(e, "aria-labelledby") ?? "").trim() !== "",
  );
}

export const a11yEmptyHeadings = check(meta("a11y.empty-headings", "Heading has no text", "warning", ["WCAG 1.3.1", "WCAG 2.4.6"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      const isHeading = HEADING_TAGS.has(element.tagName) || attr(element, "role")?.trim().toLowerCase() === "heading";
      if (!isHeading || isHidden(element) || hasAccessibleContent(element)) continue;
      const location = locate(page, element);
      out.push({
        message: `<${element.tagName}> is a heading with no text. Screen reader users hear "heading" and nothing else, and it appears in their heading list as a blank entry.`,
        location,
        fix: {
          kind: "manual",
          summary: "Write the heading text, or remove the element if it is only there for spacing; use CSS margin or padding for space.",
          edits: [],
        },
        key: `${element.tagName}:${attr(element, "id") ?? ""}:${location.line ?? ""}`,
      });
    }
  }
  return out;
});
