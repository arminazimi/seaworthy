// GitHub Action for Seaworthy: a thin adapter over the verify API (epic E-action, issue #88).
//
// The composite `action.yml` at the repository root runs the verify CLI once per site named by
// the `site` input, each time with `--format json`, and this package does the rest:
//
//   parse the inputs → read each report JSON → map it to SARIF 2.1.0 → fail the run at the threshold
//
// The `summary` input decides whether the same report JSON also fills the run page's job summary
// (./summary.ts). That is a third channel beside the SARIF upload and the pull-request comment
// (./pr-comment.ts): a job summary is `$GITHUB_STEP_SUMMARY` markdown on the run page, never a
// comment on the PR, and it shares no file, marker, or code path with the comment.
//
// The mapping reuses the one in @seaworthy/verify (ADR 0008 is the single authority for how findings
// become SARIF), imported as the package that an action checkout lays out with npm ci; the tsconfig
// paths mapping keeps the typecheck on the same checkout instead of a published dependency.

import type { Report, Severity, SarifContext } from "@seaworthy/verify";
import { toSarif } from "@seaworthy/verify";

export type { SarifContext };

/** The severity levels an Action run can fail at, matching the CLI's `--fail-on`. */
export type Threshold = Severity | "none";
export const THRESHOLDS: readonly Threshold[] = ["error", "warning", "note", "none"];

/** Whether the run writes its `$GITHUB_STEP_SUMMARY` job summary (issue #260). */
export type SummaryMode = "on" | "off";
export const SUMMARY_MODES: readonly SummaryMode[] = ["on", "off"];

/** Error for an input that is missing or outside its documented values. */
export class ActionInputError extends Error {}

/** Error for report JSON that is not a Seaworthy report. */
export class ReportFormatError extends Error {}

export interface ActionInputs {
  /** The built site folders to verify, relative to the workspace. Empty: one site, the CLI's own discovery of dist, build, out, public, _site, site. */
  sites: string[];
  /** The severity that fails the run: exit code 1 with findings at or above it, 4 when a check crashes. Global: every site runs at the same threshold. */
  threshold: Threshold;
  /** Where the SARIF report is written, relative to the workspace, or "" when SARIF is disabled. With several sites this names one file per site (see `sarifTargets`). */
  sarif: string;
  /** Markdown files or directories for the `md.*` checks, as the CLI's `--markdown` takes them. Global: forwarded to every site's run. Empty: the site-folder walk. */
  markdown: string[];
  /** `on` writes the run's job summary to `$GITHUB_STEP_SUMMARY`; `off` leaves a workflow with exactly the exit code it had before (issue #260). */
  summary: SummaryMode;
}

/** Env keys for the `Verify the site` step, so the YAML stays declarative and the code stays testable. */
export const INPUT_ENV = {
  site: "SEAWORTHY_SITE",
  threshold: "SEAWORTHY_THRESHOLD",
  sarif: "SEAWORTHY_SARIF",
  markdown: "SEAWORTHY_MARKDOWN",
  summary: "SEAWORTHY_SUMMARY",
} as const;

/**
 * Reads the Action inputs from the environment. Values come as plain text from the workflow, so
 * surrounding whitespace is trimmed and the threshold is case-insensitive. Unknown values are an
 * Action input error: silently falling back to a default would hide a typo'd threshold.
 */
export function parseInputs(env: Readonly<Record<string, string | undefined>>): ActionInputs {
  const raw = (env.SEAWORTHY_THRESHOLD ?? "error").trim().toLowerCase() as Threshold;
  const threshold = (THRESHOLDS as readonly string[]).includes(raw) ? raw : undefined;
  if (threshold === undefined) throw new ActionInputError(`the threshold must be one of ${THRESHOLDS.join(", ")}, not "${env.SEAWORTHY_THRESHOLD}"`);
  const sites = entryList(env.SEAWORTHY_SITE);
  for (const site of sites) assertInsideWorkspace(site);
  const rawSummary = (env.SEAWORTHY_SUMMARY ?? "on").trim().toLowerCase() as SummaryMode;
  const summary = (SUMMARY_MODES as readonly string[]).includes(rawSummary) ? rawSummary : undefined;
  if (summary === undefined) throw new ActionInputError(`the summary must be one of ${SUMMARY_MODES.join(", ")}, not "${env.SEAWORTHY_SUMMARY}"`);
  return {
    sites,
    threshold,
    sarif: (env.SEAWORTHY_SARIF ?? "").trim(),
    markdown: entryList(env.SEAWORTHY_MARKDOWN),
    summary,
  };
}

/**
 * A list input as the CLI and the Action take it: one entry per line or comma, each trimmed,
 * empty entries dropped so a trailing separator in a workflow block scalar costs nothing.
 * Entries may contain spaces — only newlines and commas separate them.
 */
function entryList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * The trust rule from AGENTS.md, enforced on every site folder: the Action verifies folders
 * inside the repository workspace and nothing else. Absolute paths and `..` segments would
 * reach outside it, and the Action never runs the user's build commands — building each site
 * stays the caller's own workflow steps.
 */
function assertInsideWorkspace(site: string): void {
  const escaped = site.startsWith("/") || site.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(site) || site.split(/[\\/]/).includes("..");
  if (escaped) throw new ActionInputError(`the site "${site}" must be a folder inside the workspace: relative to the workspace root, no absolute paths and no ".." segments`);
}

/**
 * The SARIF target one site's run writes, given the single `sarif` input path.
 *
 * With one site (or the CLI's auto-discovered default) the path is used exactly as given —
 * byte-identical to the behaviour before multi-site support. With several sites the given path
 * is only a template: the sanitized site folder is appended before the extension, so
 * `out/seaworthy.sarif` with sites `dist` and `blog/_site` becomes
 * `out/seaworthy.dist.sarif` and `out/seaworthy.blog-_site.sarif`. Sanitizing keeps the file
 * name portable: path separators and anything outside `[A-Za-z0-9._-]` (spaces, for instance)
 * become dashes.
 */
export function sarifTargetFor(site: string, sarif: string): string {
  const label = site.split(/[\\/]/).filter(Boolean).join("-").replace(/[^A-Za-z0-9._-]+/g, "-");
  const stemEnd = Math.max(sarif.lastIndexOf("/"), sarif.lastIndexOf("\\"));
  const dot = sarif.lastIndexOf(".");
  return dot > stemEnd ? `${sarif.slice(0, dot)}.${label}${sarif.slice(dot)}` : `${sarif}.${label}`;
}

/**
 * The SARIF targets for a list of sites, in site order: the `sarif` input as given for a single
 * site, one derived file per site for several. Empty when SARIF is disabled.
 */
export function sarifTargets(sites: readonly string[], sarif: string): string[] {
  if (sarif === "") return [];
  if (sites.length <= 1) return [sarif];
  return sites.map((site) => sarifTargetFor(site, sarif));
}

/**
 * The run's exit code from one CLI outcome per site: the Action fails if any site fails, and a
 * crash is reported as itself. Precedence: 2 (a site was rejected at the CLI level, so the
 * invocation itself is wrong) beats 4 (a check or the engine crashed) beats 1 (findings at or
 * above the threshold) beats 0 (every site clean).
 */
export function aggregateExit(codes: readonly number[]): number {
  for (const code of [USAGE_EXIT, CRASH_EXIT, FINDINGS_EXIT]) if (codes.includes(code)) return code;
  return 0;
}

/** Exit codes the aggregate rule orders; the CLI's own contract (packages/verify/src/cli/types.ts). */
const USAGE_EXIT = 2;
const CRASH_EXIT = 4;
const FINDINGS_EXIT = 1;

/** Minimal shape of the report JSON the CLI writes, checked before the SARIF mapping trusts it. */
function asReport(value: unknown): Report {
  const report = value as Partial<Report> | null;
  const ok =
    typeof report === "object" &&
    report !== null &&
    typeof report.spec === "number" &&
    typeof report.root === "string" &&
    typeof (report as Report).summary?.findings === "number" &&
    Array.isArray(report.checks) &&
    Array.isArray(report.findings) &&
    Array.isArray(report.skipped) &&
    Array.isArray(report.errors);
  if (!ok) throw new ReportFormatError("the verify report is not a Seaworthy report JSON (spec number, root, summary, checks, findings, skipped, errors)");
  return report as Report;
}

/**
 * Maps report JSON to a SARIF 2.1.0 log. Delegates to verify's mapping (ADR 0008), so repository
 * fingerprints, locations, and fixes follow exactly the rules `verify --format sarif` uses; the JSON
 * report is what crosses the CLI boundary, so it is re-checked here rather than trusted.
 */
export function sarifFromReportJson(report: unknown, context: SarifContext = {}): object {
  return toSarif(asReport(report), context);
}

/** The SARIF log as the exact text the Action writes to disk: 2-space JSON with a trailing newline. */
export function formatSarifFromReportJson(report: unknown, context: SarifContext = {}): string {
  return JSON.stringify(sarifFromReportJson(report, context), null, 2) + "\n";
}
