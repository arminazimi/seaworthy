// --markdown <paths...>: the Markdown files the md.* checks should read — for projects whose
// README and docs/ live outside the built folder the run walks. The parser only collects the
// raw path arguments; the command resolves them against the cwd and rejects bad ones.

import { UsageError } from "../types.js";
import type { Options } from "./index.js";

export interface MarkdownOptions {
  /** Every `--markdown` path argument, in flag order, unresolved. Empty: the site-folder walk, as ever. */
  markdown: string[];
}

export const MARKDOWN_DEFAULTS: MarkdownOptions = { markdown: [] };

export const MARKDOWN_FLAGS: readonly string[] = ["--markdown"];

export const MARKDOWN_HELP = `  --markdown <paths...>
                       Read these Markdown files or directories (paths relative to the current folder)
                       for the Markdown checks, instead of walking the built folder. The list ends at
                       the next --flag; pass the site folder first.
`;

export function parseMarkdown(options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number): number {
  const paths: string[] = [];
  let next = index;
  if (inline !== undefined) paths.push(inline);
  else {
    while (next + 1 < args.length && !args[next + 1]!.startsWith("--")) {
      next += 1;
      paths.push(args[next] as string);
    }
  }
  // Reassigned, never pushed into: the shared MARKDOWN_DEFAULTS array must stay pristine.
  options.markdown = [...options.markdown, ...paths];
  if (options.markdown.length === 0) throw new UsageError(`${flag} needs at least one path`);
  return next;
}
