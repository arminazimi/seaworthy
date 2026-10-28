// html.*: document-level HTML conformance that the parsed page reveals.
// html.obsolete rules and replacements live in html-data.ts.

import { TextDecoder } from "node:util";

import type { HtmlElement, Page, SiteGraph } from "../site.js";
import { attr } from "../site.js";
import type { FindingDraft } from "../types.js";
import { OBSOLETE_ATTRIBUTES, OBSOLETE_ELEMENTS } from "./html-data.js";
import { check, documentLocation, firstElement, locate, meta, pagesOf, readSiteFile, replaceEdit, startTagText } from "./helpers.js";

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

// ---- html.inline-handlers --------------------------------------------------------------------------------
// Inline handlers and javascript: URLs only fail once a strict Content Security Policy is deployed, so they
// are notes. The message says what the CSP blocks; browsers today still run both.

const CSP_EVENT = 'A strict Content Security Policy (script-src without "unsafe-inline") blocks them,';

/** URL attributes where following the attribute executes a `javascript:` URL. */
const JAVASCRIPT_URL_ATTRIBUTES: Record<string, readonly string[]> = {
  a: ["href"],
  area: ["href"],
  button: ["formaction"],
  form: ["action"],
  iframe: ["src"],
  input: ["formaction"],
};

export const htmlInlineHandlers = check(meta("html.inline-handlers", "Inline event handler or javascript: URL blocks a strict CSP", "note", ["HTML Standard", "Content Security Policy Level 3"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    // Stable identity per attribute: same element tag, attribute name, and position in document order. No line numbers.
    const counts = new Map<string, number>();
    const key = (base: string): string => {
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      return `${base}:${count}`;
    };

    for (const element of page.elements) {
      const urlAttributes = JAVASCRIPT_URL_ATTRIBUTES[element.tagName];
      for (const attribute of element.attrs) {
        const name = attribute.name.toLowerCase();
        const place = urlAttributes?.includes(name) ? name : undefined;

        // parse5 lowercases names. Any attribute that starts with "on" is an event handler; the runtime decides
        // what it should do, so a check can only name it. This includes handlers that never fire, such as an
        // unknown event: they all keep a strict CSP from being deployable.
        if (name.length > 2 && name.startsWith("on")) {
          out.push({
            message: `The ${name} attribute on <${element.tagName}> is an inline event handler. ${CSP_EVENT} so the page loses the behavior it registers.`,
            location: locate(page, element, attribute.name),
            fix: {
              kind: "manual",
              summary: `Move the ${name} code into an external script file and attach it with addEventListener. A strict CSP cannot allow inline handlers: "unsafe-inline" also lets code that is injected into the page run.`,
              edits: [],
            },
            key: key(`handler:${element.tagName}:${name}`),
          });
        } else if (place !== undefined && /^\s*javascript:/i.test(attribute.value)) {
          out.push({
            message: `The ${place} attribute on <${element.tagName}> uses a javascript: URL. ${CSP_EVENT} so the page loses what the URL does.`,
            location: locate(page, element, attribute.name),
            fix: {
              kind: "manual",
              summary: `Use a real address instead, or make the element a <button> whose click listener lives in an external script. A strict CSP cannot allow javascript: URLs: "unsafe-inline" also lets code that is injected into the page run.`,
              edits: [],
            },
            key: key(`javascript:${element.tagName}:${place}`),
          });
        }
      }
    }
  }
  return out;
});
