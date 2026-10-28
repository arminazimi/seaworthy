// Builds the versioned report. Output is deterministic: sorted, fixed key order, no timestamps,
// and no absolute paths, so two runs on the same site are byte-identical.

import { REPORT_SPEC_VERSION, VERSION } from "./version.js";
import type { SuppressedFinding } from "./suppress.js";
import { SEVERITIES, type Check, type CheckError, type Finding, type Readability, type Report, type SkippedCheck } from "./types.js";
import { findingPrompt, reportPrompt } from "./prompt.js";

/** The report cap when no `--max-findings` is given: large enough for any real site, small enough that a broken site stays readable. */
export const DEFAULT_MAX_FINDINGS = 1000;

export interface ReportInput {
  /** The folder that was verified, as the user gave it. Must be relative. */
  root: string;
  pages: number;
  checks: readonly Check[];
  findings: readonly Finding[];
  suppressed?: readonly SuppressedFinding[];
  baselined?: number;
  baselineStale?: number;
  /** Set under --changed: how many files changed. */
  changedFiles?: number;
  readability?: Readability;
  skipped?: readonly SkippedCheck[];
  errors?: readonly CheckError[];
  /** The report keeps at most this many findings. Default: `DEFAULT_MAX_FINDINGS`. Findings beyond a cap are counted, not reported. */
  maxFindings?: number;
  /** Per-check caps, keyed by check ID, applied in report order before `maxFindings`. */
  checkMaxFindings?: Readonly<Record<string, number>>;
}

const compare = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sort order: file, line (findings without a line last), column, check ID, fingerprint. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    compare(a.location.file, b.location.file) ||
    compare(a.location.line ?? Number.MAX_SAFE_INTEGER, b.location.line ?? Number.MAX_SAFE_INTEGER) ||
    compare(a.location.column ?? 0, b.location.column ?? 0) ||
    compare(a.checkId, b.checkId) ||
    compare(a.fingerprint, b.fingerprint)
  );
}

/**
 * Applies the caps to findings already in report order: each check first, then the whole report.
 * Deterministic because the order is the report's own, so the kept findings are the report's first.
 */
export function capFindings(findings: readonly Finding[], maxFindings: number, checkMaxFindings?: Readonly<Record<string, number>>): { findings: Finding[]; omitted: number } {
  let kept = [...findings];
  if (checkMaxFindings !== undefined && Object.keys(checkMaxFindings).length > 0) {
    const keptByCheck = new Map<string, number>();
    kept = kept.filter((f) => {
      const cap = checkMaxFindings[f.checkId];
      if (cap === undefined) return true;
      const count = keptByCheck.get(f.checkId) ?? 0;
      if (count >= cap) return false;
      keptByCheck.set(f.checkId, count + 1);
      return true;
    });
  }
  if (kept.length > maxFindings) kept = kept.slice(0, maxFindings);
  return { findings: kept, omitted: findings.length - kept.length };
}

export function buildReport(input: ReportInput): Report {
  if (/^([a-zA-Z]:)?[\\/]/.test(input.root)) throw new Error("report root must be relative; absolute paths make reports differ between machines");
  const sorted = [...input.findings].sort(compareFindings);
  const { findings, omitted } = capFindings(sorted, input.maxFindings ?? DEFAULT_MAX_FINDINGS, input.checkMaxFindings);
  // Counts over ALL findings, capped or not: the exit code is decided from these, so a cap can
  // never hide an error (or warning, under --fail-on warning) that was cut from the report.
  const bySeverity: Report["summary"]["bySeverity"] = {};
  for (const severity of SEVERITIES) {
    const count = sorted.filter((f) => f.severity === severity).length;
    if (count > 0) bySeverity[severity] = count;
  }
  return {
    spec: REPORT_SPEC_VERSION,
    tool: { name: "seaworthy", version: VERSION },
    root: input.root,
    summary: { pages: input.pages, findings: findings.length, bySeverity, suppressed: (input.suppressed ?? []).length, baselined: input.baselined ?? 0, baselineStale: input.baselineStale ?? 0, ...(omitted > 0 ? { findingsOmitted: omitted } : {}), ...(input.changedFiles === undefined ? {} : { changedFiles: input.changedFiles }), ...(input.readability === undefined ? {} : { readability: input.readability }) },
    checks: input.checks
      .map((c) => ({ id: c.meta.id, title: c.meta.title, severity: c.meta.severity, needs: [...c.meta.needs], docs: c.meta.docs, standards: [...c.meta.standards] }))
      .sort((a, b) => compare(a.id, b.id)),
    findings: findings.map((f) => ({ ...f, prompt: findingPrompt(f, input.root) })),
    suppressed: [...(input.suppressed ?? [])].sort((a, b) => compare(a.file, b.file) || compare(a.line ?? 0, b.line ?? 0) || compare(a.checkId, b.checkId) || compare(a.fingerprint, b.fingerprint)),
    skipped: [...(input.skipped ?? [])],
    errors: [...(input.errors ?? [])],
    ...(findings.length > 0 ? { prompt: reportPrompt(findings, input.root) } : {}),
  };
}

/** Stable JSON text of a report, ending in a newline. */
export function reportToJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}
