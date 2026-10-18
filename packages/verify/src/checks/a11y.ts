// a11y.*: static accessibility rules that need no browser (epic E-a11y-static).

import { attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { ancestors, check, descendants, isHidden, locate, meta, pagesOf, replaceAttribute, textOf } from "./helpers.js";

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

/** True for elements that a keyboard can reach: links with href, enabled form controls, and anything with tabindex of 0 or more. */
function isFocusable(element: Parameters<typeof attr>[0]): boolean {
  const tabindex = attr(element, "tabindex");
  if (tabindex !== undefined && /^\s*[+-]?\d+\s*$/.test(tabindex)) return Number.parseInt(tabindex, 10) >= 0;
  if (attr(element, "disabled") !== undefined && ["button", "input", "select", "textarea"].includes(element.tagName)) return false;
  if (element.tagName === "input") return attr(element, "type")?.trim().toLowerCase() !== "hidden";
  if (element.tagName === "a" || element.tagName === "area") return attr(element, "href") !== undefined;
  if (["button", "select", "textarea"].includes(element.tagName)) return true;
  if (element.tagName === "summary") return true;
  if (attr(element, "contenteditable") !== undefined && attr(element, "contenteditable")?.trim().toLowerCase() !== "false") return true;
  return false;
}

export const a11yHiddenFocusable = check(meta("a11y.hidden-focusable", "Focusable element is inside aria-hidden content", "error", ["WCAG 4.1.2", "WCAG 2.4.3"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (attr(element, "aria-hidden")?.trim().toLowerCase() !== "true") continue;
      // Report the aria-hidden element once, naming the first focusable thing it hides.
      const hidden = [element, ...descendants(element)].filter((e) => isFocusable(e) && ![e, ...ancestors(e)].some((a) => attr(a, "hidden") !== undefined || attr(a, "inert") !== undefined));
      const first = hidden[0];
      if (!first) continue;
      // A nested aria-hidden is covered by the outer one.
      const outer = ancestors(element).some((a) => attr(a, "aria-hidden")?.trim().toLowerCase() === "true");
      if (outer) continue;
      const location = locate(page, element, "aria-hidden");
      out.push({
        message: `aria-hidden="true" on <${element.tagName}> hides ${hidden.length === 1 ? "a focusable element" : `${hidden.length} focusable elements`} from screen readers, but keyboard focus can still reach ${hidden.length === 1 ? "it" : "them"}: <${first.tagName}>${first === element ? "" : " inside it"}. Users land on something they cannot hear.`,
        location,
        fix: {
          kind: "manual",
          summary: 'Remove aria-hidden="true" if the content is meant to be used. If it is decoration or an off-screen panel, make it unreachable too: add the hidden or inert attribute, or tabindex="-1" on each focusable element.',
          edits: [],
        },
        key: `${element.tagName}:${attr(element, "id") ?? first.tagName}:${hidden.length}`,
      });
    }
  }
  return out;
});
