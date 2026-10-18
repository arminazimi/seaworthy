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

export const a11yDuplicateId = check(meta("a11y.duplicate-id", "Page has the same id on more than one element", "warning", ["WCAG 1.3.1", "WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    const first = new Map<string, { line: number | undefined; count: number }>();
    for (const element of page.elements) {
      const id = attr(element, "id");
      if (!id) continue;
      const location = locate(page, element, "id");
      const seen = first.get(id);
      if (!seen) {
        first.set(id, { line: location.line, count: 1 });
        continue;
      }
      seen.count += 1;
      out.push({
        message: `id="${id}" is already used by another element${seen.line ? ` on line ${seen.line}` : ""}. Links to #${id}, <label for>, and aria-labelledby or aria-describedby reach only the first one.`,
        location,
        fix: {
          kind: "manual",
          summary: `Give each element a unique id. Rename this one and every reference to it (href="#${id}", for="${id}", aria-*="${id}").`,
          edits: [],
        },
        key: `${id}:${seen.count}`,
      });
    }
  }
  return out;
});

const ID_REFERENCES = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-flowto", "aria-details", "aria-activedescendant", "aria-errormessage"] as const;

export const a11yAriaReferences = check(meta("a11y.aria-references", "ARIA attribute points at an id that does not exist", "error", ["WCAG 1.3.1", "WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      for (const name of ID_REFERENCES) {
        const raw = attr(element, name);
        if (raw === undefined) continue;
        const missing = raw.split(/\s+/).filter((id) => id !== "" && !page.ids.has(id));
        if (missing.length === 0) continue;
        const location = locate(page, element, name);
        out.push({
          message: `${name}="${raw.trim()}" on <${element.tagName}> points at ${missing.length === 1 ? "an id" : "ids"} that ${missing.length === 1 ? "does" : "do"} not exist on this page: ${missing.join(", ")}. Assistive technology ignores the reference.`,
          location,
          fix: {
            kind: "manual",
            summary: `Add an element with ${missing.length === 1 ? `id="${missing[0]}"` : "each missing id"}, or correct the reference to an id that exists on this page. For a name that is plain text, aria-label is simpler.`,
            edits: [],
          },
          key: `${name}:${missing.join(" ")}:${element.tagName}`,
        });
      }
    }
  }
  return out;
});
