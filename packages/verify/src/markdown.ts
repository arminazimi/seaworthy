// The Markdown graph: built once per run over a folder of Markdown source files,
// read-only for the checks that consume it. Mirrors site.ts, but for the repo's
// Markdown source instead of built HTML: ordered headings with GitHub-flavored
// anchor slugs, plus outgoing links (inline and reference) and images.
// Site contents are untrusted input: parsed, never evaluated or executed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, resolve, sep } from "node:path";

export interface MdHeading {
  /** 1-based line the heading starts on. */
  readonly line: number;
  /** ATX level 1-6, or 1-2 for setext underlines. */
  readonly level: number;
  /** Plain heading text: link text and image alt text kept, code-span backticks and emphasis markers dropped. */
  readonly text: string;
  /** GitHub-flavored anchor slug, unique within the file (first copy unsuffixed, then `-1`, `-2`, ...). */
  readonly slug: string;
}

export interface MdLink {
  /** Raw href as written, without reference label or title. */
  readonly href: string;
  /** 1-based line the link starts on. */
  readonly line: number;
  readonly kind: "external" | "internal" | "ignored";
  /** For internal links, the root-relative URL path of the target, for example `/docs/guide.md`;
   *  fragment-only links point at their own file. */
  readonly path: string | undefined;
  /** The in-repo Markdown file the link resolves to, or undefined when it is missing from the graph. */
  readonly file: string | undefined;
  /** Decoded fragment (a heading to resolve by slug in `file`), or undefined. */
  readonly fragment: string | undefined;
}

export interface MdImage {
  readonly src: string;
  readonly line: number;
  readonly kind: "external" | "internal" | "ignored";
  /** The in-repo file the image resolves to, or undefined for external, ignored, and missing targets. */
  readonly file: string | undefined;
}

export interface MarkdownFile {
  /** File path relative to the root, forward slashes. */
  readonly file: string;
  /** Root-relative URL path of the file, for example `/docs/guide.md`. Key in `files`. */
  readonly url: string;
  readonly source: string;
  /** Headings in document order. */
  readonly headings: readonly MdHeading[];
  /** Outgoing links in document order; images are in `images` and not repeated here. */
  readonly links: readonly MdLink[];
  readonly images: readonly MdImage[];
}

export interface MarkdownGraph {
  /** Absolute path of the root. Checks must not put it in findings. */
  readonly root: string;
  /** Every parsed file keyed by its root-relative URL path, sorted by path. */
  readonly files: ReadonlyMap<string, MarkdownFile>;
  /** Heading of a file whose GitHub anchor slug matches, or undefined. */
  headingFor(file: string, slug: string): MdHeading | undefined;
}

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const IGNORED_SCHEMES = /^(mailto|tel|sms|javascript|data|blob|about):/i;
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D/gu;
const NON_SLUG_CHARS = /[^\p{L}\p{N}\s_-]/gu;
const SPACES = /[ \t]/g;
const CODE_SPAN = /`+[\s\S]*?`+/g;
const HTML_ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-f]+);/gi;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** HTML entities decode to the character they render as, so slugs match GitHub's text content. */
function decodeEntity(match: string): string {
  const body = match.slice(1, -1).toLowerCase();
  if (body.startsWith("#")) {
    const code = Number.parseInt(body[1] === "x" ? body.slice(2) : body.slice(1), body[1] === "x" ? 16 : 10);
    try {
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    } catch {
      return " ";
    }
  }
  return NAMED_ENTITIES[body] ?? " ";
}

export interface Slugger {
  /** Next unique GitHub-flavored slug for one file's headings, in document order. */
  slug(text: string): string;
}

/** Per-file state for heading slug deduplication, matching GitHub anchors. */
export function createSlugger(): Slugger {
  const used = new Set<string>();
  return {
    slug(text: string): string {
      const base = slugify(text);
      if (!used.has(base)) {
        used.add(base);
        return base;
      }
      let suffix = 1;
      while (used.has(`${base}-${suffix}`)) suffix += 1;
      const candidate = `${base}-${suffix}`;
      used.add(candidate);
      return candidate;
    },
  };
}

/** Lowercase, emoji removed, punctuation and symbols stripped, each space becomes a dash. */
function slugify(text: string): string {
  return text
    .replace(EMOJI, "")
    .toLowerCase()
    .replace(NON_SLUG_CHARS, "")
    .replace(SPACES, "-");
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

/** Plain heading text for slugs and display: links keep their text, images their alt,
 *  code spans their contents; emphasis markers, HTML tags, and entities are normalized.
 *  Intraword underscores and identifiers such as `foo_bar` are kept intact. */
export function headingText(raw: string): string {
  let text = raw.trim().replace(/[ \t]+#+$/, " "); // trailing closing `#` sequence
  text = text.replace(/!\[([^\[\]]*)\]\([^()\n]*\)/g, "$1"); // image alt text
  text = text.replace(/!?\[([^\[\]]*)\]\([^()\n]*\)/g, "$1"); // link text
  text = text.replace(/\[([^\[\]]*)\]\[([^\[\]]*)\]/g, "$1"); // reference forms
  text = text.replace(CODE_SPAN, (span) => span.slice(1, -1)); // code spans keep their contents
  text = text.replace(/<(https?:\/\/[^>\n]*|mailto:[^>\n]*)>/gi, "$1"); // autolinks keep the URL
  text = text.replace(/<\/?[a-zA-Z][^<>\n]*>/g, ""); // plain HTML tags
  text = text.replace(/&nbsp;/gi, " ").replace(HTML_ENTITY, decodeEntity);
  text = text
    .replace(/\*\*(?=\S)([\s\S]*?)(?<=\S)\*\*/g, "$1") // **strong**
    .replace(/\*(?=\S)([^\s*]+)\*/g, "$1") // *emphasis*
    .replace(/(?<![\w\\])__(?=\S)([\s\S]*?)(?<=\S)__(?!\w)/g, "$1") // __strong__
    .replace(/(?<![\w\\])_(?=\S)([\s\S]*?)(?<=\S)_(?!\w)/g, "$1") // _emphasis_, not intraword underscores
    .replace(/~~(?=\S)([\s\S]*?)(?<=\S)~~/g, "$1"); // ~~strike~~
  return text.trim();
}

interface RawLink {
  readonly href: string;
  readonly line: number;
}

interface RawImage {
  readonly src: string;
  readonly line: number;
}

/** A reference-style link or image whose definition was not seen yet; resolved after the pass. */
interface PendingRef {
  readonly kind: "link" | "image";
  readonly label: string;
  readonly id: string;
  readonly line: number;
  readonly atLink: number;
  readonly atImage: number;
}

interface Parsed {
  readonly headings: MdHeading[];
  readonly links: readonly RawLink[];
  readonly images: readonly RawImage[];
  readonly refs: ReadonlyMap<string, string>;
}

const IMAGE_INLINE = /!\[([^\[\]]*)\]\(\s*(?:<([^<>\n]*)>|([^()\s]*))?[\t ]*(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))?[\t ]*\)/g;
const LINK_INLINE = /(?<!\!)\[([^\[\]]*)\]\(\s*(?:<([^<>\n]*)>|([^()\s]*))?[\t ]*(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))?[\t ]*\)/g;
const IMAGE_REFERENCE = /!\[([^\[\]]*)\]\[([^\[\]]*)\]/g;
const LINK_REFERENCE = /(?<!\!)\[([^\[\]]+)\]\[([^\[\]]*)\]/g;
const LINK_AUTOLINK = /<(https?:\/\/[^\s<>\n]*|mailto:[^\s<>\n]*)>/gi;
const LINK_SHORTCUT = /(?<!\!)(?<!\\)\[([^\[\]]+)\](?!\[)/g;
const DEFINITION = /^\[([^\[\]]+)\]:[\t ]*(.*)$/;
const ATX = /^(#{1,6})(?=[ \t]|$)/;
const SETEXT = /^(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^(?:[*=_-][ \t]{0,2}){3,}$/;
const LIST_MARKER = /^\s*(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;

function scrub(match: string): string {
  return " ".repeat(match.length);
}

function referenceHref(label: string, id: string, refs: ReadonlyMap<string, string>): string | undefined {
  const key = (id === "" ? label : id).toLowerCase().trim();
  return refs.get(key);
}

/** Inline scan for one text line: images first, then links. Unknown forms degrade to plain text. */
function scanInline(
  text: string,
  line: number,
  refs: ReadonlyMap<string, string>,
  out: { links: RawLink[]; images: RawImage[]; pending: PendingRef[] },
): void {
  let rest = text.replace(CODE_SPAN, " "); // code spans hold link syntax; keep their contents out
  for (const [match, , angle, plain] of [...rest.matchAll(IMAGE_INLINE)]) {
    out.images.push({ line, src: angle ?? plain ?? "" });
    rest = rest.replace(match, scrub);
  }
  for (const [match, alt, id] of [...rest.matchAll(IMAGE_REFERENCE)]) {
    const href = referenceHref(alt ?? "", id ?? "", refs);
    if (href !== undefined) {
      out.images.push({ line, src: href });
      rest = rest.replace(match, scrub);
    } else {
      out.pending.push({ kind: "image", label: alt ?? "", id: id ?? "", line, atLink: out.links.length, atImage: out.images.length });
      rest = rest.replace(match, scrub);
    }
  }
  for (const [, url] of [...rest.matchAll(LINK_AUTOLINK)]) out.links.push({ line, href: url ?? "" });
  rest = rest.replace(LINK_AUTOLINK, scrub);
  for (const [match, , angle, plain] of [...rest.matchAll(LINK_INLINE)]) {
    out.links.push({ line, href: angle ?? plain ?? "" });
    rest = rest.replace(match, scrub);
  }
  for (const [match, label, id] of [...rest.matchAll(LINK_REFERENCE)]) {
    const href = referenceHref(label ?? "", id ?? "", refs);
    if (href !== undefined) {
      out.links.push({ line, href });
      rest = rest.replace(match, scrub);
    } else {
      out.pending.push({ kind: "link", label: label ?? "", id: id ?? "", line, atLink: out.links.length, atImage: out.images.length });
      rest = rest.replace(match, scrub);
    }
  }
  for (const [match, label] of [...rest.matchAll(LINK_SHORTCUT)]) {
    const href = referenceHref(label ?? "", "", refs);
    if (href !== undefined) {
      out.links.push({ line, href });
      rest = rest.replace(match, scrub);
    } else {
      out.pending.push({ kind: "link", label: label ?? "", id: "", line, atLink: out.links.length, atImage: out.images.length });
      rest = rest.replace(match, scrub);
    }
  }
}

/** Removes blockquote markers (`>`, `> >`) while leaving quoted content; nesting caps out harmlessly. */
function stripBlockquotes(line: string): string {
  let work = line.replace(/^[ \t]{1,3}/, "");
  for (let i = 0; i < 32; i++) {
    if (work.startsWith(">")) {
      work = work.slice(1).replace(/^[ \t]/, "");
      continue;
    }
    const indented = work.replace(/^[ \t]{1,3}/, "");
    if (indented !== work && indented.startsWith(">")) {
      work = indented.slice(1).replace(/^[ \t]/, "");
      continue;
    }
    break;
  }
  return work;
}

/** Line-based GitHub-flavored parse: headings (ATX and setext), outgoing links
 *  (inline, reference, shortcut, autolink), images, reference definitions.
 *  Fenced and indented code, YAML front matter, and code spans stay out of the findings. */
export function parseMarkdown(source: string): Parsed {
  const slugger = createSlugger();
  const lines = source.split(/\r\n|\r|\n/);
  const headings: MdHeading[] = [];
  const links: RawLink[] = [];
  const images: RawImage[] = [];
  const refs = new Map<string, string>();
  const pending: PendingRef[] = [];
  const out = { links, images, pending };

  // YAML front matter would read as setext headings; identify its span once up front.
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index++) {
      if (lines[index]?.trim() === "---" || lines[index]?.trim() === "...") {
        bodyStart = index + 1;
        break;
      }
    }
  }

  let fence: { char: string; length: number } | undefined;
  let inIndentedCode = false;
  let blank = false;
  let prevText: { line: number; text: string } | undefined;

  for (let index = bodyStart; index < lines.length; index++) {
    const line = index + 1;
    const raw = lines[index] ?? "";
    if (fence === undefined && raw.trim() === "") {
      inIndentedCode = false;
      blank = true;
      continue;
    }
    if (fence !== undefined) {
      const close = /^(`{3,}|~{3,})[\t ]*$/.exec(raw.replace(/^[ \t]+/, ""));
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = undefined;
      continue;
    }

    const indent = leadingIndent(raw);
    if (indent >= 4) {
      if (blank) { // indented code block starts; cannot interrupt a paragraph
        blank = false;
        continue;
      }
      blank = false;
      if (prevText !== undefined) {
        const continuation = raw.trim(); // lazy paragraph continuation
        prevText = { line: prevText.line, text: `${prevText.text} ${continuation}` };
        scanInline(continuation, line, refs, out);
      }
      continue;
    }
    inIndentedCode = false;

    const content = stripBlockquotes(raw);
    if (content === "") {
      blank = true;
      continue;
    }
    blank = false;

    const opened = FENCE_OPEN.exec(content);
    if (opened) {
      fence = { char: opened[1]![0]!, length: opened[1]!.length };
      prevText = undefined;
      continue;
    }

    const definition = DEFINITION.exec(content);
    if (definition) {
      const label = definition[1]!.toLowerCase().trim();
      if (!refs.has(label)) {
        let href = definition[2]!.trim();
        const angle = /^<([^<>\n]*)>/.exec(href);
        if (angle) href = angle[1] ?? "";
        else href = href.split(/[\t ]+/)[0] ?? ""; // trailing title in quotes or parens is dropped
        refs.set(label, href);
      }
      prevText = undefined;
      continue;
    }

    const atx = ATX.exec(content);
    if (atx) {
      const level = atx[1]!.length;
      const rest = content.slice(level).replace(/^[ \t]/, "");
      const text = headingText(rest);
      headings.push({ line, level, text, slug: slugger.slug(text) });
      scanInline(rest, line, refs, out);
      prevText = undefined;
      continue;
    }

    const underline = SETEXT.exec(content);
    if (underline && prevText !== undefined) {
      const level = content[0] === "=" ? 1 : 2;
      const text = headingText(prevText.text);
      headings.push({ line: prevText.line, level, text, slug: slugger.slug(text) });
      prevText = undefined;
      continue;
    }

    if (THEMATIC_BREAK.test(content) || LIST_MARKER.test(content)) {
      scanInline(content, line, refs, out);
      prevText = undefined;
      continue;
    }

    scanInline(content, line, refs, out);
    prevText = { line, text: content };
  }

  // Reference-style matches that ran ahead of their definitions resolve now, in scan
  // order and at the position they were skipped at, keeping document order intact.
  let atLink = 0;
  let atImage = 0;
  for (const ref of pending) {
    const href = referenceHref(ref.label, ref.id, refs);
    if (href === undefined) continue;
    if (ref.kind === "link") {
      links.splice(ref.atLink + atLink, 0, { href, line: ref.line });
      atLink += 1;
    } else {
      images.splice(ref.atImage + atImage, 0, { src: href, line: ref.line });
      atImage += 1;
    }
  }

  return { headings, links, images, refs };
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function lookup(path: string, urls: ReadonlySet<string>): string | undefined {
  const candidates = path.endsWith("/") ? [`${path}index.md`] : [path, `${path}.md`, `${path}/index.md`];
  return candidates.find((candidate) => urls.has(candidate));
}

/** Classifies one href and, for internal links, finds the in-repo file it serves. */
export function resolveTarget(
  fromUrl: string,
  href: string,
  urls: ReadonlySet<string>,
): { kind: "external" | "internal" | "ignored"; path: string | undefined; file: string | undefined; fragment: string | undefined } {
  const trimmed = href.trim();
  if (trimmed === "" || IGNORED_SCHEMES.test(trimmed)) return { kind: "ignored", path: undefined, file: undefined, fragment: undefined };
  if (trimmed.startsWith("//") || SCHEME.test(trimmed)) return { kind: "external", path: undefined, file: undefined, fragment: undefined };
  const hash = trimmed.indexOf("#");
  const beforeHash = hash === -1 ? trimmed : trimmed.slice(0, hash);
  const fragment = hash === -1 || hash + 1 === trimmed.length ? undefined : safeDecode(trimmed.slice(hash + 1));
  const pathPart = safeDecode(beforeHash.split("?")[0] ?? "");
  const absolute = pathPart.startsWith("/") ? posix.normalize(pathPart) : undefined;
  const url = pathPart === "" ? fromUrl : absolute ?? posix.normalize(posix.join(posix.dirname(fromUrl), pathPart));
  return { kind: "internal", path: url, file: lookup(url, urls), fragment };
}

function walk(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name), out);
    } else if (entry.isFile() && MARKDOWN_EXTENSION.test(entry.name)) {
      out.push(join(directory, entry.name));
    }
  }
  return out;
}

/** Builds the Markdown graph for a folder of Markdown source files. Throws if the folder does not exist. */
export function buildMarkdownGraph(rootDirectory: string): MarkdownGraph {
  const root = resolve(rootDirectory);
  if (!statSync(root).isDirectory()) throw new Error(`${rootDirectory} is not a directory`);

  const paths = walk(root)
    .map((path) => path.slice(root.length + 1).split(sep).join("/"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sources = new Map<string, MarkdownFile["source"]>();
  for (const file of paths) sources.set(`/${file}`, readFileSync(join(root, ...file.split("/")), "utf8"));

  const parsed = new Map<string, Parsed>();
  for (const [url, source] of sources) parsed.set(url, parseMarkdown(source));
  const urls = new Set<string>(sources.keys());
  const anchors = new Map<string, Map<string, MdHeading>>();

  const files = new Map<string, MarkdownFile>();
  for (const [url, source] of sources) {
    const found = parsed.get(url)!;
    const bySlug = new Map<string, MdHeading>();
    for (const heading of found.headings) bySlug.set(heading.slug, heading);
    anchors.set(url, bySlug);
    files.set(url, {
      file: url.slice(1),
      url,
      source,
      headings: found.headings,
      links: found.links.map(({ href, line }) => {
        const target = resolveTarget(url, href, urls);
        return { href, line, kind: target.kind, path: target.path, file: target.file, fragment: target.fragment };
      }),
      images: found.images.map(({ src, line }) => {
        const target = resolveTarget(url, src, urls);
        return { src, line, kind: target.kind, file: target.file };
      }),
    });
  }

  return {
    root,
    files,
    headingFor(file, slug) {
      return anchors.get(file.startsWith("/") ? file : `/${file}`)?.get(slug);
    },
  };
}
