// GitHub Action for Seaworthy: a thin adapter over the verify API (epic E-action, issue #88).
//
// The composite `action.yml` at the repository root runs the verify CLI once with
// `--format json`, and this package does the rest:
//
//   parse the inputs → read the report JSON → map it to SARIF 2.1.0 → fail the run at the threshold
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

/** Error for an input that is missing or outside its documented values. */
export class ActionInputError extends Error {}

/** Error for report JSON that is not a Seaworthy report. */
export class ReportFormatError extends Error {}

export interface ActionInputs {
  /** The built site folder, relative to the workspace, or "" to let the CLI discover its default. */
  site: string;
  /** The severity that fails the run: exit code 1 with findings at or above it, 4 when a check crashes. */
  threshold: Threshold;
  /** Where the SARIF report is written, relative to the workspace, or "" when SARIF is disabled. */
  sarif: string;
  /** Markdown files or directories for the `md.*` checks, as the CLI's `--markdown` takes them. Empty: the site-folder walk. */
  markdown: string[];
}

/** Env keys for the `Verify the site` step, so the YAML stays declarative and the code stays testable. */
export const INPUT_ENV = {
  site: "SEAWORTHY_SITE",
  threshold: "SEAWORTHY_THRESHOLD",
  sarif: "SEAWORTHY_SARIF",
  markdown: "SEAWORTHY_MARKDOWN",
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
  return {
    site: (env.SEAWORTHY_SITE ?? "").trim(),
    threshold,
    sarif: (env.SEAWORTHY_SARIF ?? "").trim(),
    markdown: markdownPaths(env.SEAWORTHY_MARKDOWN),
  };
}

/**
 * The `markdown` input as the CLI takes it: one entry per line or comma, each trimmed, empty
 * entries dropped so a trailing newline in a workflow block scalar costs nothing.
 */
function markdownPaths(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

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
