// Shared plumbing for the md.* checks: the Markdown graph, built lazily and cached per site graph,
// so an HTML-only run pays nothing. This module exports no Check, so tools/gen-registries.mjs never
// treats it as one (same as helpers.ts). It also holds the two helpers the md.* chain reuses:
// a unique-basename lookup for repair suggestions and a text-anchored replace edit for Markdown sources.

import { posix } from "node:path";

import { type MarkdownFile, type MarkdownGraph, type MarkdownSources, buildMarkdownGraph } from "../markdown.js";
import type { SiteGraph } from "../site.js";
import type { Edit } from "../types.js";

// Keyed by the SiteGraph object, so the cache entry dies with the run that built it.
// The entry also remembers the explicit sources it was built for: one run passes one
// MarkdownSources object to every md.* check, so the graph is still built once.
const cache = new WeakMap<SiteGraph, { sources: MarkdownSources | undefined; graph: MarkdownGraph }>();

/**
 * The site's Markdown graph, built on first use and cached for this run.
 * Undefined when the root holds no Markdown files: md.* checks then report nothing.
 * `graph.root` is absolute: never put it in a finding, report `MarkdownFile.file` (site-relative).
 * With `sources` (from `--markdown`) the graph is built over exactly those files, keyed relative
 * to `sources.root`, instead of walking the site folder.
 */
export function markdownOf(site: SiteGraph, sources?: MarkdownSources): MarkdownGraph | undefined {
  let entry = cache.get(site);
  if (entry === undefined || entry.sources !== sources) {
    // the site folder exists; buildMarkdownGraph only walks it (or reads the named sources)
    entry = { sources, graph: sources === undefined ? buildMarkdownGraph(site.root) : buildMarkdownGraph(sources.root, sources.files) };
    cache.set(site, entry);
  }
  return entry.graph.files.size === 0 ? undefined : entry.graph;
}

/**
 * The Markdown file whose basename equals the missing target's basename, compared case-insensitively —
 * only when exactly one file matches. Undefined when none or several match: never guess a target
 * the graph does not contain, never guess between two files with the same name.
 */
export function uniqueFileByBasename(graph: MarkdownGraph, targetPath: string): MarkdownFile | undefined {
  const base = posix.basename(targetPath).toLowerCase();
  if (base === "") return undefined;
  let found: MarkdownFile | undefined;
  for (const file of graph.files.values()) {
    if (posix.basename(file.url).toLowerCase() !== base) continue;
    if (found !== undefined) return undefined;
    found = file;
  }
  return found;
}

/**
 * A replace edit in a Markdown source file, the way `replaceEdit` does for HTML pages:
 * only when `find` occurs on that line of the source exactly once; otherwise undefined, never a guess.
 */
export function markdownReplaceEdit(file: MarkdownFile, line: number, find: string, replace: string): Edit | undefined {
  if (find === "") return undefined;
  const text = file.source.split(/\r\n|\r|\n/)[line - 1];
  // The text must occur exactly once on the line, so the edit can never land on a different link.
  if (text === undefined || text.indexOf(find) === -1 || text.indexOf(find) !== text.lastIndexOf(find)) return undefined;
  return { file: file.file, line, action: "replace", find, replace };
}
