// md.images: images in Markdown sources that point at a file the site does not contain, and images
// with no alt text. The Markdown twins of assets.missing and images.alt, and consistent with them:
// the same image seen in the source instead of the built page, so a `.md` that never reaches the
// build is still checked, and a Markdown image and its built `<img>` carry the same severity.
// Site contents are untrusted input: the source is parsed with regexes, never evaluated or executed.

import { posix } from "node:path";

import type { MarkdownFile } from "../markdown.js";
import type { LinkTarget } from "../site.js";
import type { Edit, FindingDraft } from "../types.js";
import { check, meta, withAttribute } from "./helpers.js";
import { markdownOf, markdownReplaceEdit } from "./markdown-graph.js";

// ---- raw <img> HTML written inside a Markdown source -------------------------------------------------

/** An `<img>` tag: `<img` followed by whitespace, `/` or `>`, so `<image>` and `<img.png>` are not tags.
 *  Quoted attribute values may hold a `>`, so quotes are consumed before the tag ends. */
const IMG_TAG = /<img(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>])*)>/gi;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const CODE_SPAN = /`+[\s\S]*?`+/g;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const FENCE_CLOSE = /^(`{3,}|~{3,})[\t ]*$/;

const blankOut = (match: string): string => match.replace(/[^\n]/g, " ");

/** Blanks HTML comments and code spans, keeping every character position, so lines stay where they are. */
function hideMarkup(source: string): string {
  return source.replace(HTML_COMMENT, blankOut).replace(CODE_SPAN, blankOut);
}

function leadingIndent(line: string): number {
  let indent = 0;
  for (const char of line) {
    if (char === " ") indent += 1;
    else if (char === "\t") indent += 4 - (indent % 4);
    else break;
  }
  return indent;
}

/** 1-based lines a reader never sees markup on: YAML front matter, fenced code, and indented code blocks. */
function codeLines(lines: readonly string[]): Set<number> {
  const out = new Set<number>();
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index++) {
      const trimmed = lines[index]!.trim();
      if (trimmed === "---" || trimmed === "...") {
        for (let above = 0; above <= index; above++) out.add(above + 1);
        bodyStart = index + 1;
        break;
      }
    }
  }

  let fence: { char: string; length: number } | undefined;
  let blank = false;
  let indented = false;
  for (let index = bodyStart; index < lines.length; index++) {
    const line = lines[index]!;
    if (fence !== undefined) {
      const close = FENCE_CLOSE.exec(line.replace(/^[ \t]+/, ""));
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = undefined;
      out.add(index + 1);
      continue;
    }
    if (line.trim() === "") {
      blank = true;
      indented = false;
      continue;
    }
    if (leadingIndent(line) >= 4) {
      // Four spaces after a blank line open an indented code block, which runs until a less-indented line.
      // A still-indented line inside a paragraph is a lazy continuation a reader does see, so it stays visible.
      if (blank || indented) {
        indented = true;
        out.add(index + 1);
      }
      continue;
    }
    blank = false;
    indented = false;
    const opened = FENCE_OPEN.exec(line.replace(/^[ \t]{1,3}/, ""));
    if (opened) {
      fence = { char: opened[1]![0]!, length: opened[1]!.length };
      out.add(index + 1);
    }
  }
  return out;
}

/** One `<img>` tag as written, with its attributes lowercased; the value is undefined for a bare attribute. */
interface ImgTag {
  readonly line: number;
  readonly tag: string;
  readonly attrs: ReadonlyMap<string, string | undefined>;
}

function attributesOf(text: string): Map<string, string | undefined> {
  const attrs = new Map<string, string | undefined>();
  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = match[1];
    if (name === undefined) continue;
    const key = name.toLowerCase();
    if (!attrs.has(key)) attrs.set(key, match[2] ?? match[3] ?? match[4] ?? undefined);
  }
  return attrs;
}

/** Every raw HTML `<img>` in a Markdown source, in document order, outside code and comments. */
function imgTags(source: string): ImgTag[] {
  const lines = source.split(/\r\n|\r|\n/);
  const hidden = codeLines(lines);
  const out: ImgTag[] = [];
  let lineIndex = 0;
  let lineStart = 0;
  for (const match of hideMarkup(source).matchAll(IMG_TAG)) {
    const at = match.index ?? 0;
    while (lineIndex + 1 < lines.length && at >= lineStart + lines[lineIndex]!.length + 1) {
      lineStart += lines[lineIndex]!.length + 1;
      lineIndex += 1;
    }
    if (hidden.has(lineIndex + 1)) continue;
    out.push({ line: lineIndex + 1, tag: source.slice(at, at + match[0].length), attrs: attributesOf(match[1] ?? "") });
  }
  return out;
}

/** An image a screen reader is told to skip, or that is named some other way, needs no alt text.
 *  The same exemptions `images.alt` applies to a built `<img>`. */
function exempt(attrs: ReadonlyMap<string, string | undefined>): boolean {
  const role = attrs.get("role")?.trim().toLowerCase();
  const hidden = attrs.get("aria-hidden")?.trim().toLowerCase();
  return role === "presentation" || role === "none" || hidden === "true" || (attrs.get("aria-label") ?? "").trim() !== "" || (attrs.get("aria-labelledby") ?? "").trim() !== "";
}

// ---- missing-file rule -------------------------------------------------------------------------------

/** The src to suggest for a found file, in the same style (relative or root-absolute) as the broken one. */
function srcFor(fromUrl: string, foundUrl: string, original: string): string {
  const suffix = /[?#].*$/.exec(original)?.[0] ?? "";
  if (original.startsWith("/") && !original.startsWith("//")) return `${foundUrl}${suffix}`;
  const relative = posix.relative(posix.dirname(fromUrl), foundUrl);
  return `${relative === "" ? posix.basename(foundUrl) : relative}${suffix}`;
}

/**
 * The one site file whose basename equals the missing target's, compared case-insensitively —
 * only when exactly one matches, over `files` sorted once by the caller. Undefined when none or
 * several match: never guess a path the site does not have, never pick between two same-named files.
 */
function uniqueFileByBasename(files: readonly string[], targetPath: string): string | undefined {
  const base = posix.basename(targetPath).toLowerCase();
  if (base === "") return undefined;
  let found: string | undefined;
  for (const url of files) {
    if (posix.basename(url).toLowerCase() !== base) continue;
    if (found !== undefined) return undefined;
    found = url;
  }
  return found;
}

/** One finding draft for an image whose internal target is not in the site; undefined when it resolves. */
function missingFileFinding(file: MarkdownFile, src: string, line: number, target: LinkTarget, siteFiles: readonly string[]): FindingDraft | undefined {
  if (target.kind !== "internal" || target.file !== undefined) return undefined;
  const missing = target.path.slice(1); // site-relative, like every finding path
  const near = uniqueFileByBasename(siteFiles, target.path);
  const replacement = near === undefined ? undefined : srcFor(file.url, near, src);
  const edit = replacement === undefined ? undefined : markdownReplaceEdit(file, line, src, replacement);
  return {
    message: `Image to ${src} points at a file that does not exist in the site.`,
    location: { file: file.file, line },
    fix: {
      kind: edit === undefined ? "manual" : "edit",
      summary:
        near !== undefined && edit !== undefined
          ? `Point the image at ${near.slice(1)}, the only file named ${posix.basename(near)} in the site, or create ${missing}.`
          : `Create ${missing}, or point the image at a file that exists.`,
      edits: edit === undefined ? [] : [edit],
    },
    key: src,
  };
}

export const mdImages = check(
  meta("md.images", "An image in Markdown points at a missing file or has no alt text", "error", ["WCAG 1.1.1"], ["files"]),
  (ctx) => {
    const graph = markdownOf(ctx.site);
    if (graph === undefined) return [];
    const siteFiles = [...ctx.site.files].sort(); // sorted, so a repair never depends on Set order
    const out: FindingDraft[] = [];
    // `graph.files` is sorted by path and images are in document order, so the findings are deterministic.
    for (const file of graph.files.values()) {
      for (const image of file.images) {
        // External and `data:`/ignored sources are not this rule's: nothing local is missing for them.
        if (image.kind !== "internal") continue;
        const finding = missingFileFinding(file, image.src, image.line, ctx.site.resolveLink(file.url, image.src), siteFiles);
        if (finding) out.push(finding);
      }
      for (const tag of imgTags(file.source)) {
        const src = tag.attrs.get("src") ?? "";
        if (src !== "") {
          const finding = missingFileFinding(file, src, tag.line, ctx.site.resolveLink(file.url, src), siteFiles);
          if (finding) out.push(finding);
        }
        // The alt rule. Markdown image syntax always carries its alt text — `![](src)` renders `alt=""`,
        // which is deliberate decoration — so a missing alt only happens in a raw HTML `<img>`.
        if (tag.attrs.has("alt") || exempt(tag.attrs)) continue;
        // The edit adds a placeholder `alt` before the tag's `>` and is kept only when the whole tag
        // anchor is unique on the line.
        const rewritten = withAttribute(tag.tag, "alt", "<describe the image>");
        const anchored = rewritten === undefined ? undefined : markdownReplaceEdit(file, tag.line, tag.tag, rewritten);
        const edit: Edit | undefined = anchored === undefined ? undefined : { ...anchored, needsInput: true }; // needsInput: only the author knows what the image shows
        out.push({
          message: `<img${src ? ` src="${src}"` : ""}> has no alt attribute.`,
          location: { file: file.file, line: tag.line },
          fix: {
            kind: edit === undefined ? "manual" : "edit",
            summary: 'Add alt text that describes what the image shows, or alt="" if it is purely decorative. Without the attribute, screen readers read out the file name.',
            edits: edit === undefined ? [] : [edit],
          },
          key: `alt:${src || "img"}`,
        });
      }
    }
    return out;
  },
);
