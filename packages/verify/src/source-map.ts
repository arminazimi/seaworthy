// Source locations: which file in the repository produced a built file, and which line produced
// one of its sections.
//
// spec/source-map/v0.md defines the contract: a generator may publish `source-map.json` at the site
// root, and every entry names a built target (plus, optionally, the anchor of a section in it) and
// the source file and line behind it. Seaworthy reads it here, so a finding at
// `docs/foo/index.html#installation` can point an agent at `src/content/docs/foo.md:41` instead of
// at the built output the agent must not edit.
//
// The contract's failure rules are this reader's rules, and they all end in the same place: no
// source location. Never a crash, never a run that fails, never a path this module made up. A
// published file is untrusted input — it is parsed as data, its paths are only ever used as report
// text, and a `source` or `target` that names something outside its root is refused. Nothing here
// touches the network.
//
// Where the map is absent, or leaves a page out, what counts is what the generator itself exposes:
// a Markdown source that declares its published path in front matter (`permalink:`) says which page
// it builds, and its headings say where an anchor's section starts. Both are the author's own
// declaration, read as published. A path inferred from a file name would be a guess, so it is not
// made: no declaration, no source location.

import { readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { type MarkdownSources, parseMarkdown } from "./markdown.js";
import type { SiteGraph } from "./site.js";
import type { Finding, SourceLocation } from "./types.js";

/** Where a build publishes its source map: always at the site root (spec/source-map/v0.md, "The file"). */
export const SOURCE_MAP_FILE = "source-map.json";

/** One usable mapping from a built file, or one section of it, to the source that produced it. */
export interface SourceMapEntry {
  /** The built file, relative to the site root, forward slashes. */
  readonly target: string;
  /** The source file, relative to the repository root the build ran in, forward slashes. */
  readonly source: string;
  /** 1-based line in `source`, the same convention as a report location. */
  readonly line: number;
  /** 1-based column in `source`, when the map names one. */
  readonly column?: number;
  /** The section's fragment identifier without its `#`; absent for a whole-file entry. */
  readonly anchor?: string;
}

/** Answers "where did this come from?" for one built file, in repository-relative paths. */
export interface SourceResolver {
  /**
   * The source location behind `file` (a site-relative built path), answered by the section entry
   * for `anchor` when the map has one, else by its whole-file entry, else by what the generator
   * declares. `undefined` when nothing says: the finding keeps its built-output location.
   */
  locate(file: string, anchor?: string): SourceLocation | undefined;
  /** Entries the reader refused, named by their `target` or by index, kept for whoever reports them. */
  readonly refused: readonly string[];
}

const ABSOLUTE_PATH = /^([a-zA-Z]:)?[\\/]/;
/** A permalink still holding a generator placeholder (`:title`, `{{ page.title }}`) is a template, not a published path. */
const TEMPLATE_MARK = /[{<%$]/;
const FRONT_MATTER_DELIMITER = /^(?:---|\.\.\.)[ \t]*$/;
const PERMALINK_LINE = /^permalink:[ \t]*(.*)$/;
/** A quoted YAML scalar, so `" /docs/foo/ "` and `'foo'` read as their contents. */
const QUOTED = /^"([^"]*)"$/;
const SINGLE_QUOTED = /^'([^']*)'$/;
/** The first tag of a snippet, with its attribute text: `<h2 id="installation" class="x">`. */
const FIRST_TAG = /^\s*<([a-zA-Z][^\s>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
/** A bare id selector is a section locator on its own: `#installation`, not `main > #installation`. */
const ID_SELECTOR = /^#[^[\s,>#]+$/;

/** A path in the form the contract requires: relative, forward slashes, and inside its own root. */
function isContainedPath(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  if (value.includes("\\")) return false;
  if (ABSOLUTE_PATH.test(value)) return false;
  return !value.split("/").some((segment) => segment === "." || segment === "..");
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** One entry, or `undefined` when it is unreadable: a missing or wrong-typed field, or a path that escapes. */
function readEntry(value: unknown): SourceMapEntry | undefined {
  const raw = plainObject(value);
  if (raw === undefined) return undefined;
  if (!isContainedPath(raw.target) || !isContainedPath(raw.source)) return undefined;
  if (!Number.isInteger(raw.line) || (raw.line as number) < 1) return undefined;
  if (raw.column !== undefined && (!Number.isInteger(raw.column) || (raw.column as number) < 1)) return undefined;
  if (raw.anchor !== undefined && (typeof raw.anchor !== "string" || raw.anchor === "" || raw.anchor.includes("#"))) return undefined;
  return {
    target: raw.target,
    source: raw.source,
    line: raw.line as number,
    ...(raw.column === undefined ? {} : { column: raw.column as number }),
    ...(raw.anchor === undefined ? {} : { anchor: raw.anchor as string }),
  };
}

/** What a whole `source-map.json` yields: the entries a consumer may use, and the names of the refused ones. */
export interface SourceMapReading {
  readonly entries: readonly SourceMapEntry[];
  readonly refused: readonly string[];
  /** True when the file was ignored whole: absent, not JSON, or not a document the contract describes. */
  readonly ignored: boolean;
}

/**
 * Reads the contract as written: an unknown `spec` greater than this reader is read for what it
 * knows, an unreadable entry is skipped by name while its neighbours survive, and a file that is not
 * valid JSON or not an object with an integer `spec` and an array `entries` is ignored entire.
 */
export function readSourceMapText(text: string): SourceMapReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { entries: [], refused: [], ignored: true };
  }
  const doc = plainObject(parsed);
  if (doc === undefined || !Number.isInteger(doc.spec) || (doc.spec as number) < 0 || !Array.isArray(doc.entries)) {
    return { entries: [], refused: [], ignored: true };
  }
  const entries: SourceMapEntry[] = [];
  const refused: string[] = [];
  for (const [index, value] of doc.entries.entries()) {
    const entry = readEntry(value);
    if (entry !== undefined) {
      entries.push(entry);
      continue;
    }
    const raw = plainObject(value);
    refused.push(typeof raw?.target === "string" && raw.target !== "" ? raw.target : `entry ${index}`);
  }
  return { entries, refused, ignored: false };
}

/** A `source` is only fact while the file is there: a stale mapping is never opened as if it were. */
function sourceIsPresent(repoRoot: string, source: string): boolean {
  try {
    return statSync(join(repoRoot, ...source.split("/"))).isFile();
  } catch {
    return false;
  }
}

function indexEntries(entries: readonly SourceMapEntry[]): { whole: Map<string, SourceMapEntry>; sections: Map<string, Map<string, SourceMapEntry>> } {
  const whole = new Map<string, SourceMapEntry>();
  const sections = new Map<string, Map<string, SourceMapEntry>>();
  for (const entry of entries) {
    // The contract allows one whole-file entry per target; a second is a broken map, and the
    // first one in file order wins so a run stays deterministic.
    if (entry.anchor === undefined) {
      if (!whole.has(entry.target)) whole.set(entry.target, entry);
      continue;
    }
    const byAnchor = sections.get(entry.target) ?? new Map<string, SourceMapEntry>();
    if (!byAnchor.has(entry.anchor)) byAnchor.set(entry.anchor, entry);
    sections.set(entry.target, byAnchor);
  }
  return { whole, sections };
}

/** The published path a source declares for itself, or `undefined` when it declares none usable. */
function declaredPermalink(source: string): string | undefined {
  const lines = source.split(/\r\n|\r|\n/);
  if (lines[0]?.trim() !== "---") return undefined;
  let value: string | undefined;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (FRONT_MATTER_DELIMITER.test(line.trim())) break;
    if (line !== line.trimStart()) continue; // indented: the key belongs to a parent, not to this document
    const found = PERMALINK_LINE.exec(line);
    if (found !== null && value === undefined) value = found[1];
  }
  if (value === undefined) return undefined;
  let text = value.trim();
  const quoted = QUOTED.exec(text) ?? SINGLE_QUOTED.exec(text);
  if (quoted !== null) text = quoted[1] ?? "";
  const comment = /\s#/.exec(text);
  if (comment !== null) text = text.slice(0, comment.index);
  text = text.trim();
  // Only a path from the site root can be matched against built output, and only a finished one:
  // a permalink still holding a placeholder names no page.
  if (!text.startsWith("/") || text.includes(":") || TEMPLATE_MARK.test(text)) return undefined;
  const path = text.split(/[?#]/)[0] ?? "";
  return path === "" ? undefined : path;
}

/** A page's source, with its section lines read only when a finding actually asks for one. */
interface GeneratorPage {
  readonly source: SourceLocation;
  headings(): ReadonlyMap<string, number>;
}

/**
 * What the generator exposes in its own sources: each Markdown file that declares a `permalink:`
 * names the built page it produces, and its headings name the line each anchor's section starts on.
 * Paths are resolved with the site graph's own URL lookup, so `/docs/guide/`, `/docs/guide`, and
 * `/docs/guide.html` all land on the page a host would serve for them.
 */
function generatorPages(site: SiteGraph, markdownSources: MarkdownSources): Map<string, GeneratorPage> {
  const pages = new Map<string, GeneratorPage>();
  for (const path of markdownSources.files) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue; // unreadable: the source says nothing, so the finding keeps its built-output location
    }
    const permalink = declaredPermalink(text);
    if (permalink === undefined) continue;
    const page = site.pageFor(permalink);
    if (page === undefined) continue; // the declaration names no page in this build
    const file = relative(markdownSources.root, path).split(sep).join("/");
    if (file === "" || file.startsWith("..") || page.file === file) continue;
    const source: SourceLocation = { file };
    let slugs: Map<string, number> | undefined;
    pages.set(page.file, {
      source,
      headings() {
        if (slugs === undefined) {
          slugs = new Map<string, number>();
          for (const heading of parseMarkdown(text).headings) {
            if (!slugs.has(heading.slug)) slugs.set(heading.slug, heading.line);
          }
        }
        return slugs;
      },
    });
  }
  return pages;
}

/** The id of the first tag in a snippet, which is the element the finding is about. */
function snippetId(snippet: string | undefined): string | undefined {
  if (snippet === undefined) return undefined;
  const tag = FIRST_TAG.exec(snippet);
  if (tag === null) return undefined;
  const attributes = tag[2] ?? "";
  for (const match of attributes.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? "").toLowerCase();
    if (name !== "id") continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    return value === "" ? undefined : value;
  }
  return undefined;
}

/**
 * The section a finding is about, when its own location names one: a bare `#id` selector or an `id`
 * on the element's markup. Anything else — a path selector, a snippet with no id — is a whole-page
 * finding, and answering it with a section would be a guess.
 */
export function anchorOf(finding: Finding): string | undefined {
  const selector = finding.location.selector;
  if (selector !== undefined && ID_SELECTOR.test(selector)) return selector.slice(1);
  return snippetId(finding.location.snippet);
}

/**
 * Builds the run's resolver: the published map first, then what the generators declare, then nothing.
 * `repoRoot` is the root the map's `source` paths are relative to and where they are checked for
 * existence — the repository the build ran in, which is where the command runs.
 */
export function sourceResolver(options: { site: SiteGraph; repoRoot: string; markdownSources?: MarkdownSources }): SourceResolver {
  const refused: string[] = [];
  const usable: SourceMapEntry[] = [];
  let text: string | undefined;
  try {
    text = readFileSync(join(options.site.root, SOURCE_MAP_FILE), "utf8");
  } catch {
    text = undefined;
  }
  const reading = text === undefined ? { entries: [], refused: [], ignored: true } : readSourceMapText(text);
  refused.push(...reading.refused);
  for (const entry of reading.entries) {
    // A target the build does not serve is nothing's finding, and a source that is no longer there
    // is a stale mapping: the contract says both degrade to the built-output location.
    if (!options.site.files.has(`/${entry.target}`)) {
      refused.push(`${entry.target} (not in the built output)`);
      continue;
    }
    if (!sourceIsPresent(options.repoRoot, entry.source)) {
      refused.push(`${entry.target} (source ${entry.source} is not there)`);
      continue;
    }
    usable.push(entry);
  }
  const { whole, sections } = indexEntries(usable);
  const generators = options.markdownSources === undefined ? new Map<string, GeneratorPage>() : generatorPages(options.site, options.markdownSources);

  return {
    locate(file, anchor) {
      const entry = anchor === undefined ? whole.get(file) : (sections.get(file)?.get(anchor) ?? whole.get(file));
      if (entry !== undefined) {
        return { file: entry.source, line: entry.line, ...(entry.column === undefined ? {} : { column: entry.column }) };
      }
      const page = generators.get(file);
      if (page === undefined) return undefined;
      const line = anchor === undefined ? undefined : page.headings().get(anchor);
      return line === undefined ? page.source : { file: page.source.file, line };
    },
    get refused(): readonly string[] {
      return refused;
    },
  };
}

/**
 * Where a finding's built file came from, when either the published map or the generator's own
 * declarations say. Advisory: it never changes what a run reports, only where an agent is sent.
 */
export function sourceLocationOf(finding: Finding, resolver: SourceResolver): SourceLocation | undefined {
  return resolver.locate(finding.location.file, anchorOf(finding));
}
