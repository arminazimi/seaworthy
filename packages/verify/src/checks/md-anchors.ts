// md.anchors: Markdown links whose `#fragment` matches no heading anchor in the file they point at.
// Anchors follow GitHub's slug rules (see markdown.ts and ADR 0010) and are compared without regard
// to case. Links whose target file is missing stay with md.links, so one dead link is one finding.

import type { MarkdownFile, MarkdownGraph } from "../markdown.js";
import type { FindingDraft } from "../types.js";
import { check, meta } from "./helpers.js";
import { markdownOf, markdownReplaceEdit } from "./markdown-graph.js";

/** GitHub's uniqueness suffix on a repeated heading: `install` and `install-1` share the base `install`. */
const UNIQUE_SUFFIX = /-\d+$/;

const anchorBase = (slug: string): string => slug.replace(UNIQUE_SUFFIX, "");

/** The href with its fragment replaced; everything before the `#` stays exactly as it was written. */
function hrefWithFragment(href: string, fragment: string): string {
  const hash = href.lastIndexOf("#");
  return hash === -1 ? href : `${href.slice(0, hash + 1)}${fragment}`;
}

/** The file's slugs, in document order. */
function slugsOf(file: MarkdownFile): string[] {
  return file.headings.map((heading) => heading.slug);
}

/**
 * The one anchor in the target file that differs from the missing one only by its uniqueness suffix —
 * the writer renamed or removed a repeated heading. Undefined when none or several match: never a guess.
 */
function dedupCandidate(file: MarkdownFile, lower: string): string | undefined {
  const base = anchorBase(lower);
  const near = slugsOf(file).filter((slug) => anchorBase(slug) === base && slug !== lower);
  return near.length === 1 ? near[0] : undefined;
}

/** The anchors worth naming in the message: same base first, then those sharing a prefix; empty when none is close. */
function nearestSlugs(file: MarkdownFile, lower: string): string[] {
  const slugs = slugsOf(file);
  const base = anchorBase(lower);
  const sameBase = slugs.filter((slug) => anchorBase(slug) === base && slug !== lower);
  if (sameBase.length > 0) return sameBase.slice(0, 3);
  const sharing = slugs.filter((slug) => slug !== lower && (slug.startsWith(base) || base.startsWith(slug)));
  return sharing.slice(0, 3);
}

/** Other Markdown files in the graph that do have this anchor, sorted by path. */
function filesWithAnchor(graph: MarkdownGraph, lower: string, targetUrl: string): string[] {
  const out: string[] = [];
  for (const file of graph.files.values()) {
    if (file.url === targetUrl) continue;
    if (file.headings.some((heading) => heading.slug === lower)) out.push(file.file);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export const mdAnchors = check(meta("md.anchors", "A Markdown link points to a heading anchor that does not exist", "error", [], ["files"]), (ctx) => {
  const graph = markdownOf(ctx.site);
  if (graph === undefined) return [];
  const out: FindingDraft[] = [];
  // `graph.files` is sorted by path and links are in document order, so the findings are deterministic.
  for (const file of graph.files.values()) {
    for (const link of file.links) {
      // Fragment-only links point at their own file, so `link.file` covers them too. A link whose
      // `file` is undefined has no target in the graph: that is md.links' finding, never this check's.
      if (link.fragment === undefined || link.file === undefined) continue;
      const target = graph.files.get(link.file);
      if (target === undefined) continue;
      // GitHub matches anchors without regard to case (ADR 0010), so `#Setup` reaches the `## Setup` heading.
      const lower = link.fragment.toLowerCase();
      if (graph.headingFor(link.file, lower) !== undefined) continue;

      const rel = target.file; // site-relative, like every finding path; never graph.root
      const near = nearestSlugs(target, lower);
      const detail =
        target.headings.length === 0
          ? `${rel} has no headings at all.`
          : near.length > 0
            ? `Closest anchors in ${rel}: ${near.join(", ")}.`
            : `Its heading anchors are: ${slugsOf(target).slice(0, 3).join(", ")}.`;
      const message = `Link to ${link.href} points at an anchor that no heading in ${rel} has. ${detail}`;

      const other = filesWithAnchor(graph, lower, link.file);
      const candidate = dedupCandidate(target, lower);
      const edit = candidate === undefined ? undefined : markdownReplaceEdit(file, link.line, link.href, hrefWithFragment(link.href, candidate));
      const summary =
        candidate !== undefined
          ? `Point the link at #${candidate}, the anchor in ${rel} that differs from #${link.fragment} only by GitHub's heading-dedup suffix, or rename that heading to match the link.`
          : other.length === 1
            ? `Write a heading in ${rel} that anchors #${lower}, or point the link at ${other[0]}#${lower}, the only Markdown file in the graph with that anchor.`
            : other.length > 1
              ? `Write a heading in ${rel} that anchors #${lower}, or point the link at one of the ${other.length} Markdown files that have it (${other.slice(0, 3).join(", ")}).`
              : `Write a heading in ${rel} whose anchor is #${lower}, or point the link at an anchor that file has.`;

      out.push({
        message,
        location: { file: file.file, line: link.line }, // no column: the graph parses transformed content
        fix: { kind: edit === undefined ? "manual" : "edit", summary, edits: edit === undefined ? [] : [edit] },
        key: link.href,
      });
    }
  }
  return out;
});
