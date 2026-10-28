// html.*: document-level HTML conformance that the parsed page reveals.
// html.obsolete rules and replacements live in html-data.ts.

import { TextDecoder } from "node:util";

import { type DefaultTreeAdapterMap, parse } from "parse5";

import type { HtmlElement, Page, SiteGraph } from "../site.js";
import { attr } from "../site.js";
import type { FindingDraft, Location } from "../types.js";
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

// ---- doctype and quirks mode --------------------------------------------------------------------------------

const HTML_WHITESPACE = /[ \t\n\r\f]/;

/** The only markup the HTML Standard defines: `<!doctype html>` or its legacy-compat system form. */
const LEGACY_COMPAT = /^system[ \t\r\n\f]+(?:"about:legacy-compat"|'about:legacy-compat')$/i;

/** A doctype token whose mode no browser can rely on unless the document is rewritten. */
interface Doctype { name: string; extra: string; start: number; end: number }

type LeadingDoctype = Doctype | { blocked: true } | undefined;

/**
 * The doctype a browser would act on: a byte order mark, whitespace, comments, and bogus comments such as
 * `<?xml ...?>` may come first. A doctype after an element or non-whitespace text is ignored by the parser,
 * so the document renders in quirks mode anyway.
 */
function leadingDoctype(source: string): LeadingDoctype {
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < source.length && HTML_WHITESPACE.test(source[i]!)) i++;
    if (i >= source.length) return undefined;
    if (source[i] !== "<") return { blocked: true }; // non-whitespace text kicks the parser out of the initial state

    if (source.startsWith("<!--", i)) {
      i = source.indexOf("-->", i + 4);
      if (i === -1) return undefined;
      i += 3;
      continue;
    }
    // `<? ... >` and other `<! ... >` declarations are bogus comments: the parser stays in the initial state.
    const bogus = source.startsWith("<?", i) || (source.startsWith("<!", i) && !/^<!doctype/i.test(source.slice(i, i + 11)));
    const strayEndTag = source[i + 1] === "/";
    if (bogus || strayEndTag) {
      i = source.indexOf(">", i + 1);
      if (i === -1) return undefined;
      i++;
      continue;
    }
    if (source.startsWith("<!", i)) {
      const end = source.indexOf(">", i + 9);
      const stop = end === -1 ? source.length : end;
      let j = i + 9;
      while (j < stop && HTML_WHITESPACE.test(source[j]!)) j++;
      let k = j;
      while (k < stop && !HTML_WHITESPACE.test(source[k]!) && source[k] !== ">") k++;
      return { name: source.slice(j, k), extra: source.slice(k, stop).trim(), start: i, end: stop + 1 };
    }
    return { blocked: true }; // an element: any later doctype is ignored
  }
}

/** The standard doctype: the name `html`, with nothing after it or only the legacy-compat system identifier. */
function standardDoctype(doctype: Doctype): boolean {
  return doctype.name.toLowerCase() === "html" && (doctype.extra === "" || LEGACY_COMPAT.test(doctype.extra));
}

/** Line and column of a character offset in the source, counting from 1. */
function atOffset(page: Page, offset: number): Location {
  const before = page.source.slice(0, offset);
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  return { file: page.file, line, column: lastNewline === -1 ? offset + 1 : offset - lastNewline };
}

export const htmlDoctype = check(meta("html.doctype", "Page has no doctype, or a non-standard one", "warning", ["HTML Standard"]), (ctx) => {
  const out: FindingDraft[] = [];
  for (const page of pagesOf(ctx)) {
    const found = leadingDoctype(page.source);
    if (found !== undefined && !("blocked" in found)) {
      if (standardDoctype(found)) continue;

      const raw = page.source.slice(found.start, found.end);
      const line = atOffset(page, found.start);
      const quirks = found.name.toLowerCase() !== "html";
      const replace = raw.includes(">") ? replaceEdit(page, line.line, raw, "<!doctype html>") : undefined;
      out.push({
        message: quirks
          ? `The doctype declares ${found.name === "" ? "no document type" : found.name} instead of html, so browsers render the page in quirks mode.`
          : "The doctype is a legacy one instead of <!doctype html>, so browsers may render the page in quirks or limited-quirks mode.",
        location: line,
        severity: quirks ? "warning" : "note",
        fix: {
          kind: replace ? "edit" : "manual",
          summary: "Replace the doctype with <!doctype html>, the single doctype the HTML Standard defines. In quirks or limited-quirks mode, CSS sizing and element layout behave differently.",
          edits: replace ? [replace] : [],
        },
        key: "doctype",
      });
      continue;
    }

    // No doctype a browser can act on: the document starts in quirks mode.
    const html = firstElement(page, "html");
    const tag = html ? startTagText(page, html) : undefined;
    const position = html?.sourceCodeLocation?.startTag;
    const edit = tag && position && /^<html/i.test(tag) ? replaceEdit(page, position.startLine, "<html", "<!doctype html>\n<html") : undefined;
    out.push({
      message: "The page has no doctype before its first element, so browsers render it in quirks mode.",
      location: documentLocation(page),
      fix: {
        kind: edit ? "edit" : "manual",
        summary: "Add <!doctype html> as the first line of the document, before any element or text. In quirks mode, CSS sizing and element layout behave differently.",
        edits: edit ? [edit] : [],
      },
      key: "doctype",
    });
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
