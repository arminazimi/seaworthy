// html.*: document-level HTML conformance that the parsed page reveals.
// html.obsolete rules and replacements live in html-data.ts.

import { TextDecoder } from "node:util";

import type { HtmlElement, Page, SiteGraph } from "../site.js";
import { attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { BLOCK_OUT_OF_P, INTERACTIVE_ELEMENTS, LABELABLE, NO_INTERACTIVE_DESCENDANTS, OBSOLETE_ATTRIBUTES, OBSOLETE_ELEMENTS } from "./html-data.js";
import { ancestors, check, descendants, documentLocation, firstElement, locate, meta, pagesOf, readSiteFile, replaceEdit, startTagText } from "./helpers.js";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const BYTE_LIMIT = 1024;
const CONTENT_TYPE = /^content-type$/i;
const CHARSET_PARAMETER = /(?:^|;)\s*charset\s*=\s*"?([^";\s]+)"?/i;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export const htmlObsolete = check(meta("html.obsolete", "Element or attribute is obsolete", "note", ["HTML Standard 16.2"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    // Stable identity per element or attribute: same tag and name, counted in document order. No line numbers.
    const counts = new Map<string, number>();
    const key = (base: string): string => {
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      return `${base}:${count}`;
    };

    for (const element of page.elements) {
      // SVG has its own <font>, and HTML presentational attributes never applied there.
      if (element.namespaceURI !== HTML_NAMESPACE) continue;

      const replacement = OBSOLETE_ELEMENTS.get(element.tagName);
      if (replacement !== undefined) {
        // One finding for the element is enough; its attributes (such as <font color>) go with it.
        out.push({
          message: `<${element.tagName}> is obsolete. Browsers still render it, but the HTML Standard no longer allows it.`,
          location: locate(page, element),
          fix: { kind: "manual", summary: replacement, edits: [] },
          key: key(`element:${element.tagName}`),
        });
        continue;
      }

      for (const attribute of element.attrs) {
        const obsolete = OBSOLETE_ATTRIBUTES.get(attribute.name);
        if (obsolete === undefined) continue;
        if (obsolete.elements !== "all" && !obsolete.elements.has(element.tagName)) continue;
        out.push({
          message: `The ${attribute.name} attribute on <${element.tagName}> is obsolete. Browsers still honor it, but the HTML Standard no longer allows it.`,
          location: locate(page, element, attribute.name),
          fix: { kind: "manual", summary: obsolete.replacement, edits: [] },
          key: key(`attribute:${element.tagName}:${attribute.name}`),
        });
      }
    }
  }
  return out;
});

/** The first element that declares the page's encoding, and the byte at which it ends. */
function declaration(page: Page): { element: HtmlElement; endByte: number } | undefined {
  for (const element of page.elements) {
    if (element.tagName !== "meta") continue;
    const charset = (attr(element, "charset") ?? "").trim();
    const httpEquiv = (attr(element, "http-equiv") ?? "").trim();
    const content = attr(element, "content") ?? "";
    if (charset === "" && !(CONTENT_TYPE.test(httpEquiv) && CHARSET_PARAMETER.test(content))) continue;
    const end = element.sourceCodeLocation?.endOffset;
    if (end === undefined) continue;
    return { element, endByte: Buffer.byteLength(page.source.slice(0, end), "utf8") };
  }
  return undefined;
}

/** True when the page's raw bytes decode as UTF-8, so declaring UTF-8 would not relabel another encoding. */
function validUtf8(site: SiteGraph, page: Page): boolean {
  const file = readSiteFile(site, page.url);
  if (!file) return false;
  try {
    UTF8.decode(file.bytes);
    return true;
  } catch {
    return false;
  }
}

export const htmlCharset = check(meta("html.charset", "Page does not declare its character encoding early enough", "error", ["HTML Standard"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    // A leading byte order mark declares the encoding and is always within the first bytes.
    if (page.source.startsWith("\uFEFF")) continue;
    const found = declaration(page);
    if (found && found.endByte <= BYTE_LIMIT) continue;
    if (found) {
      out.push({
        message: `The character encoding declaration ends at byte ${found.endByte}, after the first 1,024 bytes.`,
        location: locate(page, found.element),
        fix: {
          kind: "manual",
          summary: "Move the character encoding declaration into <head> so it is completely within the first 1,024 bytes. Browsers may otherwise guess the encoding and show garbled text.",
          edits: [],
        },
        key: "charset",
      });
      continue;
    }
    const head = firstElement(page, "head");
    const tag = head ? startTagText(page, head) : undefined;
    const line = head?.sourceCodeLocation?.startTag?.startLine;
    const utf8 = validUtf8(ctx.site, page);
    const edit = utf8 && tag && line !== undefined ? replaceEdit(page, line, tag, `${tag}<meta charset="utf-8">`) : undefined;
    out.push({
      message: "The page does not declare its character encoding.",
      location: documentLocation(page),
      fix: {
        kind: edit ? "edit" : "manual",
        summary: utf8
          ? 'Add <meta charset="utf-8"> at the start of <head>, so browsers decode the rest of the page as UTF-8.'
          : "The file's encoding could not be confirmed as UTF-8. Confirm the actual encoding, then add a matching <meta charset> at the start of <head>.",
        edits: edit ? [edit] : [],
      },
      key: "charset",
    });
  }
  return out;
});

// ---- html.nesting: content models the parser accepts but browsers mishandle ------------------------------------------------
// Three rules from the issue: interactive content inside interactive content, block content inside <p>, and
// <a> inside <a>. Some of this markup never appears nested in the parsed tree: the parser has already spliced
// it apart, so the browser-visible tree is not what the source says. For those a finding is made when an
// element's implicitly closed span meets the next element's start tag at one offset — exactly where the parser
// split the document. All positions come from parse5's own source locations, never from the raw text.

const isHtml = (element: HtmlElement): boolean => element.namespaceURI === HTML_NAMESPACE;

/** True for elements that are interactive HTML content (HTML Standard §3.2.6). */
function isInteractive(element: HtmlElement): boolean {
  if (!isHtml(element)) return false;
  const required = INTERACTIVE_ELEMENTS.get(element.tagName);
  if (required === undefined) return false;
  // A hidden input is not focusable or clickable, so it is not interactive content.
  if (element.tagName === "input" && (attr(element, "type") ?? "").trim().toLowerCase() === "hidden") return false;
  if (required === "") return true;
  return attr(element, required) !== undefined;
}

/** True when `element` is the control a `<label>` labels: by `for`, or its first labelable descendant. */
function isLabeledControl(label: HtmlElement, element: HtmlElement): boolean {
  const forId = attr(label, "for");
  if (forId !== undefined) return attr(element, "id") === forId.trim();
  return descendants(label).find((candidate) => isHtml(candidate) && LABELABLE.has(candidate.tagName)) === element;
}

export const htmlNesting = check(meta("html.nesting", "Content nested outside its parent's content model", "warning", ["HTML Standard"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    // Stable identity per finding: rule and tags, counted in document order. No line numbers.
    const counts = new Map<string, number>();
    const key = (base: string): string => {
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      return `${base}:${count}`;
    };

    // Interactive inside interactive: the parser builds these as real nested elements, so ancestry is enough.
    // <a> inside <a> is split apart by the parser and handled below off the spliced document.
    for (const element of page.elements) {
      if (!isInteractive(element)) continue;
      const outer = ancestors(element).find((a) => isHtml(a) && NO_INTERACTIVE_DESCENDANTS.has(a.tagName));
      if (outer === undefined || (outer.tagName === "label" && isLabeledControl(outer, element))) continue;
      if (outer.tagName === "a" && element.tagName === "a") continue;
      out.push({
        message: `<${element.tagName}> is inside <${outer.tagName}>, which cannot contain interactive content. Browsers leave both interactive at once, so focus, clicks, and Enter-key behavior are unreliable.`,
        location: locate(page, element),
        fix: {
          kind: "manual",
          summary: outer.tagName === "label"
            ? `Take the <${element.tagName}> out of the <label>. A <label> should wrap only the caption of its one control; other interactive content next to it makes label clicks act on more than the control.`
            : `Take the <${element.tagName}> out of the <${outer.tagName}> and place the two interactive elements side by side. Interactive content stays focusable even nested, so keyboard and click behavior is not what the markup suggests.`,
          edits: [],
        },
        key: key(`${outer.tagName}:${element.tagName}`),
      });
    }

    // Block inside <p> and <a> inside <a> and <button> inside <button>, off the spliced document: walk the
    // elements in document order and remember the span end of the latest implicitly closed <p>/<a>/<button>.
    // The next element's start tag lands exactly on that end when the source had it nested inside. For a
    // spliced <a> that span further extends across the element the parser spliced it at (usually a block),
    // whose content the author had written inside the link; parse5 keeps no trace of the link inside it.
    let openP: number | undefined;
    let openA: { from: number; to: number } | undefined;
    let openButton: number | undefined;
    for (const element of page.elements) {
      const location = element.sourceCodeLocation;
      if (location?.startTag === undefined) {
        // Parser-inserted elements (a stray </p> becomes one) have no start tag and no source position.
        openP = undefined;
        openA = undefined;
        openButton = undefined;
        continue;
      }
      const start = location.startTag.startOffset;
      const tag = element.tagName;
      const hasEndTag = location.endTag !== undefined;
      const html = isHtml(element);

      const inOpenA = openA !== undefined && html && tag === "a" && (start === openA.from || (start > openA.from && start < openA.to));
      const inOpenButton = openButton !== undefined && html && tag === "button" && start === openButton;
      // Each slot is read before the same element's update, so a chain <a><a><a> reports every inner link.
      if (inOpenA || inOpenButton) {
        out.push({
          message: `This <${tag}> starts before the enclosing <${tag}> is closed. The parser ends the outer <${tag}> here and rebuilds a copy of it afterwards, so the outer element's text, styling, and behavior do not match the source.`,
          location: locate(page, element),
          fix: {
            kind: "manual",
            summary: `End the outer <${tag}> before this one starts (</${tag}> <${tag} ...>), or keep one element and make the rest plain text. Nested links and buttons confuse click targets and screen-reader announcements.`,
            edits: [],
          },
          key: key(`${tag}:${tag}`),
        });
      }
      if (html && openP !== undefined && start === openP && BLOCK_OUT_OF_P.has(tag)) {
        out.push({
          message: `This <${tag}> is written inside <p>, but <p> allows only phrasing content, so the HTML parser ends the paragraph at the <${tag}> and puts everything after it outside the paragraph the source suggests.`,
          location: locate(page, element),
          fix: {
            kind: "manual",
            summary: `Close the paragraph before the <${tag}> (or move the block before or after it). When the content is meant to stay inline, use <span> with CSS instead.`,
            edits: [],
          },
          key: key(`p:${tag}`),
        });
      }

      // Each slot is updated only by its own element: intervening phrasing content preserves the pending span,
      // and a block that did not continue the paragraph ends the wait.
      if (html && tag === "p") {
        openP = hasEndTag ? undefined : location.endOffset;
      } else if (html && BLOCK_OUT_OF_P.has(tag)) {
        openP = undefined;
      }
      if (html && tag === "a") {
        openA = hasEndTag ? undefined : { from: location.endOffset, to: location.endOffset };
      } else if (html && tag === "button") {
        openButton = hasEndTag ? undefined : location.endOffset;
      } else if (openA !== undefined && start === openA.from) {
        // The element the link was spliced at carries its trailing content; items inside it were in the link.
        openA = { from: openA.from, to: location.endOffset };
      }
    }
  }
  return out;
});
