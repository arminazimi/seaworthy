// Direction test on right-to-left pages: html dir, mixed text, physical CSS.
// Three conservative signals: a missing `dir` on an RTL `<html>`, unscoped mixed-direction text on a page
// with no declared base direction, and physical CSS declarations in the stylesheets that RTL pages use.

import { type DefaultTreeAdapterMap } from "parse5";

import { type HtmlElement, type Page, type SiteGraph, attr } from "../site.js";
import type { CheckContext, Edit, FindingDraft } from "../types.js";
import { LTR_STRONG, PHYSICAL_PROPERTIES, RTL_STRONG, SIDE_KEYWORD_PROPERTIES, isRtlLanguage } from "./rtl-data.js";
import { addAttributes, ancestors, check, firstElement, isRedirectStub, locate, meta, pagesOf, readSiteFile } from "./helpers.js";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
/** Elements whose text a reader never sees; skipped when looking for mixed-direction text and styles. */
const SELF_INVISIBLE = new Set(["script", "style", "template", "noscript"]);

/** One cap for physical-declaration findings against a pathological stylesheet. */
const PHYSICAL_LIMIT = 200;

// ---- text positions --------------------------------------------------------------------------

/** 1-based line starts of a text source. */
function lineStartsOf(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** Count of newlines before an offset, so a slice can report lines inside the file it came from. */
function lineOfOffset(source: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** 1-based line and UTF-16 column of an offset in a source. */
function atOffset(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 };
}

/** The source slice of one 1-based line, without its newline. */
function lineOf(source: string, starts: number[], line: number): string {
  const from = starts[line - 1]!;
  const to = starts[line] ?? source.length;
  return source.slice(from, to).replace(/\r$/, "");
}

/** The source slice of one line and where it sits in the file: kept 1-based, so an edit names a file line. */
function replaceOnLine(source: string, starts: number[], file: string, start: number, end: number, replace: string, firstLine: number): Edit | undefined {
  const { line } = atOffset(starts, start);
  const find = source.slice(start, end);
  if (find === "" || find.includes("\n")) return undefined;
  const text = lineOf(source, starts, line);
  if (text.indexOf(find) === -1 || text.indexOf(find) !== text.lastIndexOf(find)) return undefined;
  return { file, line: line + firstLine - 1, action: "replace", find, replace };
}

// ---- the page direction ----------------------------------------------------------------------

/** True when the browser starts this page right to left: a `dir` of rtl or auto on `<html>`, or an RTL `lang` with no `dir`. */
function startsRtl(page: Page): boolean {
  const html = firstElement(page, "html");
  if (html === undefined) return false;
  const dir = (attr(html, "dir") ?? "").trim().toLowerCase();
  if (dir !== "") return dir === "rtl" || dir === "auto"; // dir="ltr" on an RTL-language page is a deliberate choice
  return isRtlLanguage((attr(html, "lang") ?? "").trim());
}

// ---- signal 1: an RTL language without a dir ---------------------------------------------------

/** The html element's `lang` names an RTL language but has no `dir`, so the browser starts the page left to right. */
function missingDir(page: Page): FindingDraft | undefined {
  const html = firstElement(page, "html");
  if (!html || attr(html, "dir") !== undefined || html.namespaceURI !== HTML_NAMESPACE) return undefined;
  const value = (attr(html, "lang") ?? "").trim();
  if (!isRtlLanguage(value)) return undefined;
  const edit = addAttributes(page, html, { dir: "rtl" });
  return {
    message: `The page language "${value}" is a right-to-left language, but <html> has no dir attribute. Browsers start every page left to right unless dir says otherwise, so the layout and text do not mirror.`,
    location: locate(page, html, "lang"),
    fix: {
      kind: edit ? "edit" : "manual",
      summary: 'Add dir="rtl" to the <html> tag. Browsers default to dir="ltr", so text, lists, tables, and punctuation line up for left-to-right reading instead of mirroring.',
      edits: edit ? [edit] : [],
    },
    key: "dir",
  };
}

// ---- signal 2: unscoped mixed-direction text ---------------------------------------------------

/** Text nodes a reader would see, with their nearest element. */
function readerText(page: Page): { parent: HtmlElement; text: string }[] {
  const out: { parent: HtmlElement; text: string }[] = [];
  const walk = (node: DefaultTreeAdapterMap["node"] | DefaultTreeAdapterMap["element"], parent: HtmlElement | undefined): void => {
    if ("tagName" in node) {
      if (SELF_INVISIBLE.has(node.tagName)) return;
      for (const child of node.childNodes as DefaultTreeAdapterMap["node"][]) walk(child, node);
      return;
    }
    if (node.nodeName === "#text" && node.value && parent !== undefined) out.push({ parent, text: node.value });
  };
  for (const child of (firstElement(page, "html")?.childNodes ?? []) as DefaultTreeAdapterMap["node"][]) walk(child, undefined);
  return out;
}

/** True when the run's direction is already scoped: a `dir` on it or between it and `<html>`, or a `bdi`/`bdo`.
 * `lang` does not scope direction — only `dir` (or explicitly isolating elements) does, so `lang="ar"` without `dir` stays a finding. */
function directionScoped(element: HtmlElement): boolean {
  for (const node of [element, ...ancestors(element)]) {
    if (node.tagName === "bdi" || node.tagName === "bdo") return true;
    if ((attr(node, "dir") ?? "").trim() !== "") return true;
  }
  return false;
}

/** One note per page: the first visible run mixing RTL and LTR characters while nothing scopes the direction. */
function mixedDirection(page: Page): FindingDraft | undefined {
  for (const { parent, text } of readerText(page)) {
    if (parent.namespaceURI !== HTML_NAMESPACE || directionScoped(parent)) continue;
    if (!RTL_STRONG.test(text) || !LTR_STRONG.test(text)) continue;
    const shown = text.replace(/\s+/g, " ").trim().slice(0, 60);
    return {
      message: `This run mixes right-to-left and left-to-right characters, and nothing scopes the direction, so the punctuation and numbers between them can land on the wrong side ("${shown}").`,
      location: locate(page, parent),
      fix: {
        kind: "manual",
        summary: 'Wrap the left-to-right part in <bdi>…</bdi>, or set dir (and lang) on the element that carries the run, or on <html>. <bdi> isolates an embedded run so the surrounding right-to-left text cannot reorder it.',
        edits: [],
      },
      key: `mixed:${parent.tagName}:${shown}`,
      severity: "note",
    };
  }
  return undefined;
}

// ---- signal 3: physical CSS in the stylesheets that RTL pages use ------------------------------

/** Replaces CSS comments and string contents with spaces, character for character, so offsets survive. */
function maskCommentsAndStrings(css: string): string {
  const out = Array.from(css);
  const blank = (from: number, to: number): void => {
    for (let j = from; j < to; j++) if (css[j] !== "\n" && css[j] !== "\r") out[j] = " ";
  };
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const quote = css[i] === '"' || css[i] === "'" ? css[i] : undefined;
    if (quote !== undefined) {
      let j = i + 1;
      while (j < css.length && css[j] !== quote && css[j] !== "\n") j++;
      blank(i, Math.min(j + 1, css.length));
      i = Math.min(j + 1, css.length);
      continue;
    }
    i++;
  }
  return out.join("");
}

/** A declaration's name must sit in a rule body, not in a selector: the previous meaningful character decides. */
function inDeclarationPosition(masked: string, nameStart: number): boolean {
  let k = nameStart - 1;
  while (k >= 0 && /[\s]/.test(masked[k]!)) k--;
  return k < 0 || masked[k] === "{" || masked[k] === ";" || masked[k] === "}";
}

/** Where a declaration's value ends in the masked source: at `;`, a brace, or the end of the line. */
function valueEnd(masked: string, valueStart: number): number {
  let i = valueStart;
  while (i < masked.length && masked[i] !== ";" && masked[i] !== "{" && masked[i] !== "}" && masked[i] !== "\n" && masked[i] !== "\r") i++;
  return i;
}

/** One CSS source: an inline `<style>` region of a page, or one internal stylesheet file. */
interface CssSource {
  /** Root-relative file path the finding and its edit carry. */
  file: string;
  text: string;
  masked: string;
  starts: number[];
  /** 1-based file line of the source's first character, so an inline `<style>` slice reports file lines. */
  firstLine: number;
}

/** Scans one CSS source; appends one finding per physical declaration, positions exact, deduplicated by position. */
function physicalDeclarations(source: CssSource, out: FindingDraft[], seen: Set<string>): void {
  const { text, masked, starts, file, firstLine } = source;
  for (const match of masked.matchAll(/([A-Za-z-]+)(\s*:\s*)/g)) {
    const name = match[1]!.toLowerCase();
    if (name.startsWith("-")) continue; // a custom property or vendor prefix, not a side declaration
    const rename = PHYSICAL_PROPERTIES.get(name);
    const keywords = SIDE_KEYWORD_PROPERTIES.get(name);
    if (rename === undefined && keywords === undefined) continue;
    const nameStart = match.index!;
    const nameEnd = nameStart + match[1]!.length;
    if (!inDeclarationPosition(masked, nameStart)) continue;
    const dedupe = `<${file}>:${nameStart}`;
    if (seen.has(dedupe)) continue;
    if (out.length >= PHYSICAL_LIMIT) return;
    seen.add(dedupe);
    const at = atOffset(starts, nameStart);
    const valueFrom = nameEnd + match[2]!.length;
    const valueText = masked.slice(valueFrom, valueEnd(masked, valueFrom));
    if (valueText.trim() === "") continue;

    let find: string;
    let replace: string;
    let message: string;
    let summary: string;
    let fixStart = nameStart;
    let fixEnd = nameEnd;
    if (rename !== undefined) {
      find = text.slice(nameStart, nameEnd);
      replace = rename;
      message = `The stylesheet sets ${name}, which keeps the same physical edge on right-to-left pages where the layout mirrors. Use ${replace}, which follows the text direction.`;
      summary = `Replace ${name} with ${replace}. Physical sides do not mirror; logical properties follow the text direction.`;
    } else {
      const keyword = /^(\s*)(left|right)(?![\w-])(.*)$/is.exec(valueText);
      if (!keyword || keyword[2] === undefined) continue;
      const tail = keyword[3]!.trim();
      if (tail !== "" && !/^!\s*important$/.test(tail)) continue;
      const logical = keywords![keyword[2]!.toLowerCase()]!;
      const kwStart = valueFrom + keyword[1]!.length;
      fixStart = kwStart;
      fixEnd = kwStart + keyword[2]!.length;
      find = text.slice(kwStart, fixEnd);
      replace = logical;
      message = `The stylesheet sets ${name} to the physical ${keyword[2]!.toLowerCase()} side, which keeps the same side on right-to-left pages where the layout mirrors. Use ${name}: ${replace}, which follows the text direction.`;
      summary = `Set ${name} to ${replace}. Physical sides do not mirror; logical properties follow the text direction.`;
    }
    // The fix edits the exact span the scan found, never a different occurrence of the same text.
    const edit = replaceOnLine(text, starts, file, fixStart, fixEnd, replace, firstLine);
    out.push({
      message,
      location: { file, line: at.line + firstLine - 1, column: at.column },
      fix: {
        kind: "edit",
        summary,
        edits: edit ? [edit] : [],
      },
      key: `${file}#${name}`,
    });
  }
}

/** Collects the CSS sources one page contributes: its inline `<style>` regions first, then its internal stylesheets. */
function cssSources(page: Page, site: SiteGraph): CssSource[] {
  const out: CssSource[] = [];
  const scan = (text: string, file: string, firstLine: number): void => {
    out.push({ file, text, masked: maskCommentsAndStrings(text), starts: lineStartsOf(text), firstLine });
  };
  for (const element of page.elements) {
    if (element.tagName !== "style" || element.namespaceURI !== HTML_NAMESPACE) continue;
    const from = element.sourceCodeLocation?.startTag?.endOffset;
    const to = element.sourceCodeLocation?.endTag?.startOffset;
    if (from === undefined || to === undefined) continue;
    scan(page.source.slice(from, to), page.file, lineOfOffset(page.source, from) + 1);
  }
  for (const element of page.elements) {
    if (element.tagName !== "link") continue;
    if (attr(element, "rel")?.trim().toLowerCase() !== "stylesheet") continue;
    const href = attr(element, "href");
    if (href === undefined || href.trim() === "") continue;
    const target = site.resolveLink(page.url, href);
    if (target.kind !== "internal" || target.file === undefined || !target.file.endsWith(".css")) continue;
    const bytes = readSiteFile(site, target.file);
    if (bytes === undefined) continue;
    scan(bytes.bytes.toString("utf8"), target.file.slice(1), 1);
  }
  return out;
}

export const rtlBidi = check(
  meta("rtl.bidi", "Right-to-left pages that do not declare or mirror their direction", "warning", ["WCAG 3.1.2"]),
  function* (ctx: CheckContext): Iterable<FindingDraft> {
    let physical = 0;
    const seen = new Set<string>();
    for (const page of pagesOf(ctx)) {
      if (isRedirectStub(page)) continue;
      if (!startsRtl(page)) continue;
      const html = firstElement(page, "html");
      const noDirOnHtml = html !== undefined && (attr(html, "dir") ?? "").trim() === "";
      const missing = missingDir(page);
      if (missing !== undefined) yield missing;
      if (noDirOnHtml) {
        const mixed = mixedDirection(page);
        if (mixed !== undefined) yield mixed;
      }
      for (const source of cssSources(page, ctx.site)) {
        const before = seen.size;
        const found: FindingDraft[] = [];
        physicalDeclarations(source, found, seen);
        if (seen.size === before) continue;
        for (const finding of found) {
          yield { ...finding, severity: "note" };
          if (++physical >= PHYSICAL_LIMIT) return;
        }
      }
    }
  },
);
