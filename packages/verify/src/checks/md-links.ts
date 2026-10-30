// md.links: relative links between Markdown files that point at missing files.

import { posix } from "node:path";

import type { FindingDraft } from "../types.js";
import { check, meta } from "./helpers.js";
import { markdownOf, markdownReplaceEdit, uniqueFileByBasename } from "./markdown-graph.js";

/** The href to suggest for a found file, in the same style (relative or root-absolute) as the broken one. */
function hrefFor(fromUrl: string, foundUrl: string, original: string): string {
  const suffix = /[?#].*$/.exec(original)?.[0] ?? "";
  if (original.startsWith("/") && !original.startsWith("//")) return `${foundUrl}${suffix}`;
  const relative = posix.relative(posix.dirname(fromUrl), foundUrl);
  return `${relative === "" ? posix.basename(foundUrl) : relative}${suffix}`;
}

export const mdLinks = check(meta("md.links", "A Markdown link points to a file that does not exist", "error", [], ["files"]), (ctx) => {
  const graph = markdownOf(ctx.site, ctx.markdownSources);
  if (graph === undefined) return [];
  const out: FindingDraft[] = [];
  // `graph.files` is sorted by path and links are in document order, so the findings are deterministic.
  for (const file of graph.files.values()) {
    for (const link of file.links) {
      // Missing targets only: external, ignored, and fragment-only links resolve or are another check's,
      // and a link whose `file` is set already finds its target in the graph.
      if (link.kind !== "internal" || link.file !== undefined || link.path === undefined) continue;
      const missing = link.path.slice(1); // site-relative, like every finding path
      const near = uniqueFileByBasename(graph, link.path);
      const replacement = near === undefined ? undefined : hrefFor(file.url, near.url, link.href);
      const edit = replacement === undefined ? undefined : markdownReplaceEdit(file, link.line, link.href, replacement);
      out.push({
        message: `Link to ${link.href} points to a file that does not exist in the Markdown sources.`,
        location: { file: file.file, line: link.line },
        fix: {
          kind: edit === undefined ? "manual" : "edit",
          summary:
            near !== undefined && edit !== undefined
              ? `Point the link at ${near.file}, the only Markdown file named ${posix.basename(near.url)} in the graph, or create ${missing}.`
              : `Create ${missing}, or point the link at a Markdown file that exists.`,
          edits: edit === undefined ? [] : [edit],
        },
        key: link.href,
      });
    }
  }
  return out;
});
