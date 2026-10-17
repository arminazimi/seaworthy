// a11y.*: static accessibility rules that need no browser (epic E-a11y-static).

import { attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { check, locate, meta, pagesOf, replaceAttribute } from "./helpers.js";

export const a11yIframeTitle = check(meta("a11y.iframe-title", "Iframe has no descriptive title", "error", ["WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (element.tagName !== "iframe" || (attr(element, "title") ?? "").trim()) continue;
      const location = locate(page, element, "title");
      out.push({
        message: "The iframe has no non-empty title to describe its content.",
        location,
        fix: {
          kind: "manual",
          summary: 'Add a descriptive title attribute to the iframe, such as title="Office location map". Name the embedded content, not just "frame".',
          edits: [],
        },
        key: `${attr(element, "id") ?? attr(element, "src") ?? "iframe"}:${location.line ?? ""}`,
      });
    }
  }
  return out;
});

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
