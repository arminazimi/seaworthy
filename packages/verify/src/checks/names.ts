// names.*: controls and links must have a name that assistive technology can announce.

import { type HtmlElement, type Page, attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { addAttributes, ancestors, check, locate, meta, pagesOf, textOf } from "./helpers.js";

const hasText = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";
const isHidden = (e: HtmlElement): boolean => attr(e, "hidden") !== undefined || attr(e, "aria-hidden")?.toLowerCase() === "true";

/** Named by an attribute: aria-label, aria-labelledby pointing at something that exists, or title. */
function namedByAttribute(page: Page, e: HtmlElement): boolean {
  if (hasText(attr(e, "aria-label")) || hasText(attr(e, "title"))) return true;
  const ref = attr(e, "aria-labelledby");
  return hasText(ref) && (ref as string).split(/\s+/).some((id) => page.ids.has(id));
}

/** Text a person would hear: the element's text plus the alt text of images and the title of SVGs inside it. */
function contentName(e: HtmlElement): string {
  let name = textOf(e);
  const visit = (node: HtmlElement): void => {
    for (const child of node.childNodes as HtmlElement[]) {
      if (child.tagName === "img" && hasText(attr(child, "alt"))) name += ` ${attr(child, "alt")}`;
      if ("childNodes" in child) visit(child);
    }
  };
  visit(e);
  return name.trim();
}

const addAriaLabel = (page: Page, element: HtmlElement) => addAttributes(page, element, { "aria-label": "<describe it>" }, true);

const NO_LABEL_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

export const namesLabel = check(meta("names.label", "Form field has no label", "error", ["WCAG 1.3.1", "WCAG 3.3.2", "WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    const labelled = new Set(page.elements.filter((e) => e.tagName === "label" && hasText(attr(e, "for"))).map((e) => attr(e, "for") as string));
    for (const field of page.elements) {
      if (!["input", "select", "textarea"].includes(field.tagName) || isHidden(field)) continue;
      if (field.tagName === "input" && NO_LABEL_TYPES.has((attr(field, "type") ?? "text").toLowerCase())) continue;
      const id = attr(field, "id");
      if ((id !== undefined && labelled.has(id)) || ancestors(field).some((a) => a.tagName === "label") || namedByAttribute(page, field)) continue;
      const location = locate(page, field);
      const edit = addAriaLabel(page, field);
      out.push({
        message: `This ${field.tagName}${id ? ` (#${id})` : ""} has no label.`,
        location,
        fix: {
          kind: edit ? "edit" : "manual",
          summary: `Add a visible <label for="${id ?? "field-id"}"> that says what to enter${id ? "" : ", and give the field that id"}. A placeholder is not a label. If a visible label is impossible, add aria-label.`,
          edits: edit ? [edit] : [],
        },
        key: id ?? `${field.tagName}:${attr(field, "name") ?? ""}:${location.line ?? ""}`,
      });
    }
  }
  return out;
});

export const namesButton = check(meta("names.button", "Button has no accessible name", "error", ["WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (isHidden(element) || namedByAttribute(page, element)) continue;
      let problem: string | undefined;
      if (element.tagName === "button" && contentName(element) === "") problem = "This button has no text.";
      else if (element.tagName === "input") {
        const type = (attr(element, "type") ?? "").toLowerCase();
        if (type === "button" && !hasText(attr(element, "value"))) problem = 'This <input type="button"> has no value.';
        else if (type === "image" && !hasText(attr(element, "alt"))) problem = 'This <input type="image"> has no alt text.';
      }
      if (problem === undefined) continue;
      const location = locate(page, element);
      const edit = addAriaLabel(page, element);
      out.push({
        message: problem,
        location,
        fix: { kind: edit ? "edit" : "manual", summary: "Give the button visible text that says what it does, or an aria-label when it only shows an icon. Without a name, a screen reader announces only \"button\".", edits: edit ? [edit] : [] },
        key: `${element.tagName}:${attr(element, "id") ?? attr(element, "class") ?? ""}:${location.line ?? ""}`,
      });
    }
  }
  return out;
});

export const namesLink = check(meta("names.link", "Link has no text", "error", ["WCAG 2.4.4", "WCAG 4.1.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    for (const element of page.elements) {
      if (element.tagName !== "a" || attr(element, "href") === undefined || isHidden(element) || namedByAttribute(page, element)) continue;
      if (contentName(element) !== "") continue;
      const location = locate(page, element);
      const href = attr(element, "href") as string;
      const edit = addAriaLabel(page, element);
      out.push({
        message: `The link to ${href || "(no address)"} has no text, so a screen reader announces only "link".`,
        location,
        fix: { kind: edit ? "edit" : "manual", summary: "Put text inside the link, or alt text on the image inside it, or add aria-label. Say where the link goes, not \"click here\".", edits: edit ? [edit] : [] },
        key: `${href}:${location.line ?? ""}`,
      });
    }
  }
  return out;
});
