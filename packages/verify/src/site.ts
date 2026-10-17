// The site graph: built once per run from a built-site folder, read-only for every check.
// It reads built output (HTML and the file list) and never a generator's internals.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, resolve, sep } from "node:path";

import { type DefaultTreeAdapterMap, parse } from "parse5";

export type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlNode = DefaultTreeAdapterMap["node"];

export interface Page {
  /** Root-relative URL path of the file, for example `/docs/guide.html`. */
  readonly url: string;
  /** File path relative to the site root, forward slashes. */
  readonly file: string;
  readonly source: string;
  /** Every element in document order, with source positions. */
  readonly elements: readonly HtmlElement[];
  /** All `id` values on the page. */
  readonly ids: ReadonlySet<string>;
}

export type LinkTarget =
  | { kind: "external"; href: string }
  | { kind: "ignored"; href: string }
  | { kind: "internal"; href: string; path: string; fragment: string | undefined; file: string | undefined };

export interface SiteGraph {
  /** Absolute path of the site root. Checks must not put it in findings. */
  readonly root: string;
  readonly pages: ReadonlyMap<string, Page>;
  /** Root-relative URL paths of every file in the site, for example `/logo.png`. */
  readonly files: ReadonlySet<string>;
  /** Classifies a link and, for internal links, finds the file it serves. */
  resolveLink(fromUrl: string, href: string): LinkTarget;
  /** The page served at a URL path (`/docs/`, `/docs`, `/docs/guide`, `/docs/guide.html`), if any. */
  pageFor(path: string): Page | undefined;
}

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
const HTML_EXTENSION = /\.html?$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const IGNORED_SCHEMES = /^(mailto|tel|sms|javascript|data|blob|about):/i;

function walk(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(directory, entry.name));
    }
  }
  return out;
}

function collectElements(node: HtmlNode, out: HtmlElement[]): void {
  if ("tagName" in node) out.push(node);
  if ("childNodes" in node) for (const child of node.childNodes) collectElements(child, out);
}

/** Returns an element's attribute value, or undefined when absent. */
export function attr(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((a) => a.name === name)?.value;
}

/** 1-based line and column of an attribute, or of the element when the attribute has no position. */
export function positionOf(element: HtmlElement, attributeName?: string): { line: number; column: number } | undefined {
  const location = element.sourceCodeLocation;
  if (!location) return undefined;
  const at = attributeName ? location.attrs?.[attributeName] : undefined;
  const source = at ?? location;
  return { line: source.startLine, column: source.startCol };
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Builds the site graph for a folder of built output. Throws if the folder does not exist. */
export function buildSite(rootDirectory: string): SiteGraph {
  const root = resolve(rootDirectory);
  if (!statSync(root).isDirectory()) throw new Error(`${rootDirectory} is not a directory`);

  const allFiles = walk(root).map((file) => ({ file, rel: file.slice(root.length + 1).split(sep).join("/") }));
  allFiles.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const files = new Set(allFiles.map(({ rel }) => `/${rel}`));
  const pages = new Map<string, Page>();
  for (const { file, rel } of allFiles) {
    if (!HTML_EXTENSION.test(rel)) continue;
    const source = readFileSync(file, "utf8");
    const elements: HtmlElement[] = [];
    collectElements(parse(source, { sourceCodeLocationInfo: true }), elements);
    const ids = new Set<string>();
    for (const element of elements) {
      const id = attr(element, "id");
      if (id) ids.add(id);
    }
    pages.set(`/${rel}`, { url: `/${rel}`, file: rel, source, elements, ids });
  }

  /** URL path to the file that a static host would serve for it. */
  function lookup(path: string): string | undefined {
    const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}.html`, `${path}/index.html`];
    return candidates.find((candidate) => files.has(candidate));
  }

  return {
    root,
    pages,
    files,
    pageFor(path) {
      const file = lookup(path);
      return file ? pages.get(file) : undefined;
    },
    resolveLink(fromUrl, href) {
      const trimmed = href.trim();
      if (trimmed === "" || IGNORED_SCHEMES.test(trimmed)) return { kind: "ignored", href };
      if (trimmed.startsWith("//") || SCHEME.test(trimmed)) return { kind: "external", href };
      const hash = trimmed.indexOf("#");
      const beforeHash = hash === -1 ? trimmed : trimmed.slice(0, hash);
      const fragment = hash === -1 ? undefined : safeDecode(trimmed.slice(hash + 1));
      const pathPart = safeDecode(beforeHash.split("?")[0] ?? "");
      const path = pathPart === "" ? fromUrl : pathPart.startsWith("/") ? posix.normalize(pathPart) : posix.normalize(posix.join(posix.dirname(fromUrl), pathPart));
      return { kind: "internal", href, path, fragment, file: lookup(path) };
    },
  };
}
