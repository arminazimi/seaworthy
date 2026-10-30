// `seaworthy explain <check-id>`: the check's docs page in the terminal. The page at
// docs/checks/<check-id>.md is the contract every check's prose lives in (docs/checks/README.md);
// this command reads it and prints it as it is. It runs no checks, reads no site, and invents
// nothing: an id the registry does not know is a usage error, never a file read.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { builtInChecks } from "../checks/index.js";
import { validateCheckId } from "../engine.js";
import type { CheckMeta } from "../types.js";
import { EXIT, UsageError, type CliEnvironment, type CliResult } from "./types.js";

const EXPLAIN_HELP = `seaworthy explain

Print a check's docs page in the terminal, as it is written: what the check reports, why it
matters, the exact rule, the fix with examples, its options, and the standards it cites. The
page is read from docs/checks/<check-id>.md; no site is needed, no check runs, and nothing on
disk is written.

Usage:
  seaworthy explain <check-id>

Arguments:
  check-id             The ID of a built-in check, such as images.alt. Run \`seaworthy verify\` to
                       see the IDs a site has findings for.

Options:
  --help, -h           Print this help

Exit codes:
  0  the page was printed
  2  no check id given, or an id no built-in check carries
`;

// The docs pages of this repository, resolved from the built CLI: <root>/docs/checks. A
// published install may not ship them; a read there degrades to the check's own metadata,
// never to a crash or an invented page.
const DEFAULT_DOCS_DIR = fileURLToPath(new URL("../../../../../docs/checks/", import.meta.url));

/** The page's text, ending in exactly one newline whatever the file on disk did. */
function withTrailingNewline(text: string): string {
  const trimmed = text.replace(/\n+$/, "");
  return `${trimmed}\n`;
}

/** What explain prints when this install carries no docs page: the check's own metadata, nothing more. */
function metaSummary(meta: CheckMeta): string {
  const lines = [
    `seaworthy: docs/checks/${meta.id}.md is not part of this install; showing the check's own metadata.`,
    "",
    `# ${meta.id}`,
    "",
    meta.title,
    "",
    `Severity: ${meta.severity}`,
    `Needs: ${meta.needs.join(", ")}`,
    `Standards: ${meta.standards.length === 0 ? "none" : meta.standards.join(", ")}`,
    `Docs: ${meta.docs}`,
    "",
  ];
  return lines.join("\n");
}

export async function explainCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  if (args.includes("-h") || args.includes("--help")) return { code: EXIT.ok, stdout: EXPLAIN_HELP, stderr: "" };
  if (args.length === 0) throw new UsageError("explain needs a check id: seaworthy explain <check-id>, such as `seaworthy explain images.alt`");
  if (args.length > 1) throw new UsageError(`explain takes one check id, not ${args.length} arguments: seaworthy explain <check-id>`);
  const id = args[0] as string;
  if (id.startsWith("-")) throw new UsageError(`unknown option ${id}; explain takes one check id and no options`);

  // Only ever an id the registry knows does a docs path get built; the report contract's own
  // ID pattern rejects separators, so a user-supplied id can never address another file.
  const meta = (env.checks ?? builtInChecks).find((check) => check.meta.id === id)?.meta;
  if (meta === undefined) throw new UsageError(`unknown check id "${id}"; explain prints the docs page of a built-in check, such as \`seaworthy explain images.alt\``);
  validateCheckId(meta.id);

  try {
    return { code: EXIT.ok, stdout: withTrailingNewline(readFileSync(join(env.docsDir ?? DEFAULT_DOCS_DIR, `${meta.id}.md`), "utf8")), stderr: "" };
  } catch {
    // The page is missing from this install. The metadata below is what the registry itself
    // carries — same fields the reports publish — so the command still lands, and says where
    // it stopped short.
    return { code: EXIT.ok, stdout: metaSummary(meta), stderr: "" };
  }
}
