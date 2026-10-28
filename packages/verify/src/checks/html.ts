// html.*: document-level HTML conformance that the parsed page reveals.
// html.obsolete rules and replacements live in html-data.ts.

import { TextDecoder } from "node:util";

import { type DefaultTreeAdapterMap, parse } from "parse5";

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

// ---- html.parse-errors --------------------------------------------------------------------------------------

// Elements that may have no end tag at all. `keygen` and the frame-family elements are obsolete void-like elements.
const HTML_VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);

// Elements whose end tag the HTML Standard lets authors omit (the HTML Standard's optional end tags, plus the
// obsolete no-end-tag elements, which browsers closed for them). Reporting those as unclosed would flag every page.
const OMITTED_END_TAGS = new Set([
  "html", "head", "body", "p", "li", "dt", "dd", "tr", "td", "th", "thead", "tbody", "tfoot", "option", "optgroup", "colgroup", "rt", "rp", "caption",
  "frame", "basefont", "isindex", "spacer", "plaintext",
]);

// Adoption-agency formatting elements: the parser restructures them, so an end tag that closes a parent instead of
// them is how browsers do it, and repeating it here would flag markup every browser and validator accepts.
const RESTRUCTURED_ELEMENTS = new Set(["a", "b", "big", "code", "em", "font", "i", "nobr", "s", "small", "strike", "strong", "tt", "u"]);

// Elements whose entire content the tokenizer reads as raw or RCDATA text, so end-tag syntax inside them is content, never an end tag.
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "textarea", "title", "plaintext", "listing"]);

/** html.parse-errors reports at most this many parser errors per page, so a pathological file cannot flood a report. */
const ERROR_LIMIT = 1000;

const HTML_PARSE_ERROR_NOTES = new Map<string, string>([
  ["duplicate-attribute", "two attributes have this name on the same element, and browsers keep the first one"],
  ["non-void-html-element-start-tag-with-trailing-solidus", "the trailing solidus does not make the element self-closing, so the element still has no end tag"],
  ["eof-in-tag", "the file ends inside a tag, so the element is never created"],
  ["end-tag-with-attributes", "an end tag has attributes, and the parser throws them away"],
  ["end-tag-with-trailing-solidus", "an end tag has a trailing solidus, which the parser ignores"],
  ["missing-end-tag-name", "the parser skipped text after </ because it does not start a tag name, and read it as a comment"],
  ["unexpected-character-in-attribute-name", "an unexpected character ended an attribute name, usually a stray quote or a missing quote"],
  ["unexpected-character-in-unquoted-attribute-value", "an unquoted attribute value ended at an unexpected character"],
  ["attribute-without-value", "an attribute has no value, and browsers give it the empty value"],
  ["unexpected-equals-sign-before-attribute-name", "an attribute name starts with an equals sign, and browsers read it as part of the name"],
  ["unexpected-solidus-in-tag", "a solidus appears where the parser cannot use it, and the parser ignores it"],
  ["unexpected-null-character", "the page contains a null character, which browsers replace or drop"],
  ["control-character-in-input-stream", "the page contains a control character, which browsers replace or drop"],
  ["surrogate-character-in-input-stream", "the page contains a surrogate character, which browsers replace or drop"],
  ["noncharacter-character-in-input-stream", "the page contains a noncharacter, which browsers replace or drop"],
  ["control-character-in-attribute-value", "an attribute value contains a control character, which browsers drop"],
  ["surrogate-in-attribute-value", "an attribute value contains a surrogate character, which browsers drop"],
  ["noncharacter-in-attribute-value", "an attribute value contains a noncharacter, which browsers drop"],
]);

interface ParseErrorPosition {
  code: string;
  line: number;
  column: number;
}

interface StrayTag {
  tag: string;
  line: number;
  column: number;
}

/** One parse of the page source, plus the end-tag scan over it. */
function analyzePage(page: Page): { errors: ParseErrorPosition[]; strays: StrayTag[] } {
  const errors: ParseErrorPosition[] = [];
  const document = parse(page.source, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (errors.length < ERROR_LIMIT) errors.push({ code: error.code, line: error.startLine, column: error.startCol });
    },
  });

  // Regions of the source the parser never treats as markup, marked per character: start tags (quotes inside an
  // attribute), comments, the doctype, and the raw text of raw-text elements and template content. End-tag syntax
  // there is content, never an end tag the parser decided to ignore.
  const notMarkup = new Uint8Array(page.source.length);
  // Sources of real end tags: an offset where some element records one. Elsewhere the token was ignored.
  const endTagStarts = new Set<number>();
  // Elements the parser built out of an end tag token: `</br>` inserts <br> and `</p>` with no open <p> inserts <p></p>,
  // so the token is a parse error only in name, not a token the parser threw away.
  const elementStarts = new Set<number>();

  const visit = (node: DefaultTreeAdapterMap["node"], raw: boolean): void => {
    if ("tagName" in node) {
      const location = (node as DefaultTreeAdapterMap["element"]).sourceCodeLocation;
      const startTag = location?.startTag;
      if (startTag) {
        for (let at = startTag.startOffset; at < startTag.endOffset; at++) notMarkup[at] = 1;
        elementStarts.add(startTag.startOffset);
      }
      if (location?.endTag) endTagStarts.add(location.endTag.startOffset);
      const rawContent = raw || RAW_TEXT_ELEMENTS.has(node.tagName);
      for (const child of (node.childNodes ?? []) as DefaultTreeAdapterMap["node"][]) visit(child, rawContent);
      const content = (node as { content?: { childNodes: DefaultTreeAdapterMap["node"][] } }).content;
      if (content) for (const child of content.childNodes as DefaultTreeAdapterMap["node"][]) visit(child, rawContent);
      return;
    }
    const location = node.sourceCodeLocation;
    // Comments, text, and doctypes have no children; only the document node is a container without a tagName.
    if (node.nodeName === "#document") {
      for (const child of node.childNodes) visit(child, raw);
      return;
    }
    if (!location) return;
    // Everything else, the parser reads whole: comments, doctypes, and raw text.
    if (raw || node.nodeName === "#comment" || node.nodeName === "#documentType") {
      for (let at = location.startOffset; at < location.endOffset; at++) notMarkup[at] = 1;
    }
  };
  visit(document, false);

  // Any end-tag-shaped text outside those regions is an end-tag token; when no element recorded an end tag at
  // exactly that offset, the parser ignored it and the end tag closes nothing.
  const strays: StrayTag[] = [];
  const pattern = /<\/([a-zA-Z][^\t\n\f\r />]*)/g;
  for (let match = pattern.exec(page.source); match !== null; match = pattern.exec(page.source)) {
    const at = match.index;
    if (notMarkup[at]) continue;
    if (endTagStarts.has(at) || elementStarts.has(at)) continue;
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < at; i++) {
      if (page.source.charCodeAt(i) === 10) {
        line++;
        lineStart = i + 1;
      }
    }
    strays.push({ tag: match[1]!.toLowerCase(), line, column: at - lineStart + 1 });
  }
  return { errors, strays };
}

export const htmlParseErrors = check(meta("html.parse-errors", "The HTML parser reported an error", "warning", ["HTML Standard"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    // Stable identity per error, end tag, or element in document order: same kind and name, counted. No line numbers.
    const counts = new Map<string, number>();
    const key = (base: string): string => {
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      return `${base}:${count}`;
    };

    const { errors, strays } = analyzePage(page);

    for (const error of errors) {
      // A missing doctype is html.doctype's finding.
      if (error.code === "missing-doctype") continue;
      const note = HTML_PARSE_ERROR_NOTES.get(error.code);
      out.push({
        message: `The HTML parser reported ${error.code}${note ? `: ${note}` : "."}`,
        location: { file: page.file, line: error.line, column: error.column },
        fix: {
          kind: "manual",
          summary: "Fix the markup the parser rejected, so the document parses cleanly. Browsers recover from parse errors, so the page may not mean what it looks like.",
          edits: [],
        },
        key: key(`error:${error.code}`),
        // Duplicate attributes hide that the later value is dead, so an agent editing the second copy changes nothing.
        ...(error.code === "duplicate-attribute" ? { severity: "error" as const } : {}),
      });
    }

    for (const stray of strays) {
      out.push({
        message: `The end tag </${stray.tag}> closes nothing: its element ended earlier or was never opened.`,
        location: { file: page.file, line: stray.line, column: stray.column },
        fix: {
          kind: "manual",
          summary: stray.tag === "br"
            ? // The parser turns </br> into a <br> element, so deleting it leaves the line break behind.
              "Use <br> instead of </br> where a line break is wanted."
            : `Delete the stray </${stray.tag}>, or reopen the element it should have closed before this end tag.`,
          edits: [],
        },
        key: key(`stray:${stray.tag}`),
      });
    }

    for (const element of page.elements) {
      // Optional end tags and void elements never need one, and foreign content has its own end-tag rules.
      if (element.namespaceURI !== HTML_NAMESPACE) continue;
      if (OMITTED_END_TAGS.has(element.tagName) || HTML_VOID_ELEMENTS.has(element.tagName)) continue;
      const location = element.sourceCodeLocation;
      if (!location?.startTag || location.endTag) continue;
      // An element whose children a later end tag of another element closed is a browser-visible restructuring, so
      // only the adoption-agency elements are left alone when their own end tag never appears.
      if (RESTRUCTURED_ELEMENTS.has(element.tagName) && page.source.startsWith("</", location.endOffset)) continue;
      out.push({
        message: `<${element.tagName}> has no end tag, so browsers keep the rest of the page inside it until a parent element closes.`,
        location: locate(page, element),
        fix: {
          kind: "manual",
          summary: `Close <${element.tagName}> where its content should end, with </${element.tagName}>.`,
          edits: [],
        },
        key: key(`unclosed:${element.tagName}`),
      });
    }
  }
  return out;
});
