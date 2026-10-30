// The `fix_preview` tool: every edit the run's findings would make, as ONE unified diff, and
// nothing written. This package is a thin adapter over the verify API (AGENTS.md): the diff and
// the edit anchoring are verify's own `planFix`, the same code path `seaworthy fix --dry-run`
// uses, so the preview is exactly what that command prints. There is no mode that writes: the
// tool verifies the folder it is given and returns the preview; applying the diff is the
// caller's job, for example with `git apply` run from the site folder.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import {
  buildSite,
  builtInChecks,
  DEFAULT_FOLDERS,
  discoverFolder,
  loadConfig,
  planFix,
  REPORT_SPEC_VERSION,
  rootLabel,
  verifySite,
} from "@seaworthy/verify";
import type { Check, Location, ManualFix, Severity } from "@seaworthy/verify";

/** Tool name, as a client would call it. Part of the MCP surface; stable once released. */
export const FIX_PREVIEW_NAME = "fix_preview";

/** What the tool emits as text, so the caller learns the preview's shape from the result itself. */
const PREVIEW_NOTE =
  "Preview only: Seaworthy reports and suggests and never edits files; nothing was written. The diff is standard unified format with a/ and b/ paths relative to the site folder, so `git apply` run from that folder applies it.";

export const FIX_PREVIEW_DESCRIPTION =
  "Verify a built static site folder and return every edit its findings' suggested fixes would make as ONE unified diff, exactly what `seaworthy fix --dry-run` prints, and write nothing: there is no mode that writes. The input is a folder to verify, not a report JSON. Findings that cannot become a safe edit — manual fixes, edits needing content only a person can supply (such as alt text), and edits whose anchor no longer matches the built file — are listed in `manual` with the reason instead of guessed. The site folder defaults to the first of dist, build, out, public, _site, site that exists.";

/** The input schema of `fix_preview`. The one input is the built site folder to verify. */
export const FIX_PREVIEW_INPUT = {
  site: z
    .string()
    .optional()
    .describe("The built site folder to verify, relative to the workspace. Default: the first of dist, build, out, public, _site, site that exists."),
};

/** The inputs of `fix_preview`. */
export interface FixPreviewInput {
  readonly site?: string | undefined;
}

export interface FixPreviewOptions {
  /** The workspace the site folder and the config resolve against. Default: process.cwd(). */
  readonly cwd?: string;
  /** The checks to run. Default: verify's built-in checks. */
  readonly checks?: readonly Check[];
}

/** Why one finding could not become a diff hunk. Key order is fixed: additive only. */
export interface PreviewManual {
  readonly checkId: string;
  readonly severity: Severity;
  readonly message: string;
  readonly location: Location;
  readonly summary: string;
  readonly reason: string;
}

/** What the tool emits. Field order is fixed; consumers parse, never stringify-compare. */
export interface FixPreviewOutput {
  /** Version of the report contract this preview belongs to (verify's REPORT_SPEC_VERSION). */
  readonly spec: number;
  /** The verified site folder, relative to the workspace — never an absolute path. */
  readonly root: string;
  /** Always false: the tool writes nothing, and the result says so in the contract itself. */
  readonly written: false;
  /** What the caller must know: this is a preview and nothing was written. */
  readonly note: string;
  /** One unified diff covering every planned edit across every file; "" when none apply. */
  readonly diff: string;
  /** Distinct edits planned (findings that propose the same edit share one). */
  readonly edits: number;
  /** Files the diff touches. */
  readonly files: number;
  /** Findings degraded to manual guidance, in report order, each with the reason. */
  readonly manual: readonly PreviewManual[];
}

/** Site files are untrusted input read by path, relative to the site root: read, never evaluated. */
function siteReader(folder: string): (file: string) => string | undefined {
  return (file: string) => {
    try {
      return readFileSync(join(folder, ...file.split("/")), "utf8");
    } catch {
      return undefined;
    }
  };
}

/**
 * Verifies a built site and returns the fix preview as deterministic JSON: fixed key order, the
 * same unified diff `seaworthy fix --dry-run` prints, and no timestamps. Writes nothing, always.
 */
export async function fixPreviewReport(input: FixPreviewInput, options: FixPreviewOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const checks = options.checks ?? builtInChecks;
  const { config } = loadConfig(cwd, undefined, checks.map((check) => check.meta.id));

  const requested = input.site ?? config.root ?? discoverFolder(cwd);
  if (requested === undefined) throw new Error(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder)) throw new Error(`no folder ${requested}; pass the folder your build writes to, or build first`);
  if (!statSync(folder).isDirectory()) throw new Error(`${requested} is not a folder; pass the folder your build writes to`);

  const site = buildSite(folder, config.basePath === undefined ? {} : { basePath: config.basePath });
  const { report } = await verifySite({ folder, site, rootLabel: rootLabel(cwd, folder), checks, config });
  const preview = planFix(report.findings, siteReader(folder));

  const output: FixPreviewOutput = {
    spec: REPORT_SPEC_VERSION,
    root: report.root,
    written: false,
    note: PREVIEW_NOTE,
    diff: preview.diff,
    edits: preview.edits,
    files: preview.files,
    manual: preview.manual.map((m): PreviewManual => ({ checkId: m.checkId, severity: m.severity, message: m.message, location: m.location, summary: m.summary, reason: m.reason })),
  };
  return JSON.stringify(output);
}
