// The `explain_finding` tool: the fix hint, the docs link, and the before/after example an
// agent needs to act on one finding. This package is a thin adapter over the verify API
// (AGENTS.md): the check's title, severity, requirements, standards, and docs URL come from
// verify's check metadata, the finding's fix hint and edits come from the report contract the
// finding already carries, and the example is read from the check's own contract page at
// docs/checks/<id>.md. No fix text is copied into this package.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { builtInChecks, validateCheckId } from "@seaworthy/verify";
import type { Check, Edit, Needs, Severity } from "@seaworthy/verify";

/** Tool name, as a client would call it. Part of the MCP surface; stable once released. */
export const EXPLAIN_FINDING_NAME = "explain_finding";

export const EXPLAIN_FINDING_DESCRIPTION =
  "Explain one Seaworthy finding the way an agent needs to fix it: the fix hint, the URL of the check's contract page, and the before/after example from that page. Pass a finding from the report JSON of verify_site for that finding's own hint and ready edits, or only a check id for the check's general fix guidance. Reads no site, runs no check, and never invents a check id.";

/** One text-anchored edit, exactly as the report contract defines it. Unknown fields are ignored. */
const editInput = z.object({
  file: z.string(),
  line: z.number().int(),
  action: z.literal("replace"),
  find: z.string(),
  replace: z.string(),
  needsInput: z.boolean().optional(),
});

/** The part of a report finding this tool explains; a finding pasted as it is validates against this. */
const findingInput = z.object({
  checkId: z.string(),
  severity: z.enum(["error", "warning", "note"]).optional(),
  message: z.string().optional(),
  location: z
    .object({
      file: z.string(),
      line: z.number().int().optional(),
      column: z.number().int().optional(),
      approximateLine: z.boolean().optional(),
      selector: z.string().optional(),
      snippet: z.string().optional(),
    })
    .optional(),
  fix: z.object({
    kind: z.enum(["edit", "manual"]),
    summary: z.string(),
    edits: z.array(editInput).optional(),
    appliesTo: z.string().optional(),
  }),
  prompt: z.string().optional(),
});

/** The input schema of `explain_finding`. At least one of the two must be given; the tool says so when neither is. */
export const EXPLAIN_FINDING_INPUT = {
  check_id: z
    .string()
    .optional()
    .describe('The check to explain, such as "images.alt". Optional when a finding is given; the finding\'s own check id is used then. With both, they must agree.'),
  finding: findingInput.optional().describe("A finding from the report JSON of verify_site, pasted as it is. Its fix hint, edits, and prompt are explained and returned verbatim."),
};

/** A finding edit as a client sends it; rebuilt into the contract's `Edit` so key order is ours, not theirs. */
interface InputEdit {
  readonly file: string;
  readonly line: number;
  readonly action: "replace";
  readonly find: string;
  readonly replace: string;
  readonly needsInput?: boolean | undefined;
}

/** A report finding, as much of it as this tool reads. Mirrors verify's `Finding`; under exactOptionalPropertyTypes the parsed shape needs explicit `| undefined`. */
export interface ExplainableFinding {
  readonly checkId: string;
  readonly severity?: Severity | undefined;
  readonly message?: string | undefined;
  readonly location?: { readonly file: string; readonly line?: number | undefined; readonly column?: number | undefined; readonly approximateLine?: boolean | undefined; readonly selector?: string | undefined; readonly snippet?: string | undefined } | undefined;
  readonly fix: { readonly kind: "edit" | "manual"; readonly summary: string; readonly edits?: readonly InputEdit[] | undefined; readonly appliesTo?: string | undefined };
  readonly prompt?: string | undefined;
}

/** What the tool accepts. */
export interface ExplainFindingInput {
  readonly check_id?: string | undefined;
  readonly finding?: ExplainableFinding | undefined;
}

export interface ExplainFindingOptions {
  /** The checks the tool knows about. Default: verify's built-in checks. */
  readonly checks?: readonly Check[];
  /** The folder of check contract pages. Default: this repository's `docs/checks`. */
  readonly docsDir?: string;
}

/** What the tool emits. Field order is fixed: additive only, like every Seaworthy contract. */
export interface ExplainFindingOutput {
  readonly checkId: string;
  readonly title: string;
  /** The finding's severity when a finding says one, else the check's default. */
  readonly severity: Severity;
  readonly needs: readonly Needs[];
  readonly standards: readonly string[];
  /** URL of the check's contract page — the docs URL verify publishes for the check. */
  readonly docs: string;
  /** The finding's own fix hint when a finding is given, else the fix guidance of the check's docs page. */
  readonly fixHint: string;
  /** The finding's ready-to-apply edits, empty without a finding or without edits. */
  readonly edits: readonly Edit[];
  /** The before/after example code from the docs page; empty when the page has none. */
  readonly example: string;
  /** The finding's ready-to-paste prompt, only when the finding carries one. */
  readonly prompt?: string;
}

// The docs pages of this repository, resolved from the built package: <root>/docs/checks. A
// published install may not ship them; reads there degrade to the docs URL, never to a crash.
const DEFAULT_DOCS_DIR = fileURLToPath(new URL("../../../../docs/checks/", import.meta.url));

/** Rebuilds an edit from the client with the contract's fixed key order. */
const toEdit = (edit: InputEdit): Edit => ({
  file: edit.file,
  line: edit.line,
  action: edit.action,
  find: edit.find,
  replace: edit.replace,
  ...(edit.needsInput === undefined ? {} : { needsInput: edit.needsInput }),
});

/** The body of the page's "## How to fix" section, or undefined when the page or the section is missing. */
function fixSection(markdown: string): string | undefined {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## How to fix");
  if (start === -1) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2} \S/.test(line)) break;
    body.push(line);
  }
  const text = body.join("\n").trim();
  return text === "" ? undefined : text;
}

/** The first fenced code block: the before/after example the contract page tells the agent to copy. */
function firstCodeBlock(markdown: string): string {
  const fenced = /```[^\n]*\n([\s\S]*?)```/.exec(markdown);
  return fenced?.[1] === undefined ? "" : fenced[1].trim();
}

/**
 * Explains one finding or one check and returns deterministic JSON: fixed key order, nothing
 * from the clock, the site, or the filesystem beyond the check's own contract page. A check id
 * the registry does not know answers with an error, never with invented guidance.
 */
export function explainFinding(input: ExplainFindingInput, options: ExplainFindingOptions = {}): string {
  const checks: readonly Check[] = options.checks ?? builtInChecks;
  const id = input.check_id ?? input.finding?.checkId;
  if (id === undefined) throw new Error("explain_finding needs a check_id or a finding; pass the check id, or the finding from the report JSON");
  if (input.check_id !== undefined && input.finding !== undefined && input.finding.checkId !== input.check_id) {
    throw new Error(`check_id "${input.check_id}" does not match the finding's check "${input.finding.checkId}"; pass one or the other, or two that agree`);
  }
  const meta = checks.find((check) => check.meta.id === id)?.meta;
  if (meta === undefined) throw new Error(`unknown check id "${id}"; explain_finding only explains checks that exist — list_checks lists them`);
  // Only ever an id the registry knows does a docs path get built, and the report contract's own
  // ID pattern rejects separators, so a client-supplied id can never address another file.
  validateCheckId(meta.id);
  let section: string | undefined;
  try {
    section = fixSection(readFileSync(join(options.docsDir ?? DEFAULT_DOCS_DIR, `${meta.id}.md`), "utf8"));
  } catch {
    section = undefined; // a docs page missing from this install is not the client's problem: the hint still lands.
  }
  const output: ExplainFindingOutput = {
    checkId: meta.id,
    title: meta.title,
    severity: input.finding?.severity ?? meta.severity,
    needs: meta.needs,
    standards: meta.standards,
    docs: meta.docs,
    fixHint: input.finding?.fix.summary ?? section ?? `See ${meta.docs}`,
    edits: (input.finding?.fix.edits ?? []).map(toEdit),
    example: section === undefined ? "" : firstCodeBlock(section),
    ...(input.finding?.prompt === undefined ? {} : { prompt: input.finding.prompt }),
  };
  return JSON.stringify(output);
}
