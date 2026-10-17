// Builds the versioned report. Output is deterministic: sorted, fixed key order, no timestamps,
// and no absolute paths, so two runs on the same site are byte-identical.

import { REPORT_SPEC_VERSION, VERSION } from "./version.js";
import type { SuppressedFinding } from "./suppress.js";
import { SEVERITIES, type Check, type CheckError, type Finding, type Report, type SkippedCheck } from "./types.js";

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
  skipped?: readonly SkippedCheck[];
  errors?: readonly CheckError[];
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

export function buildReport(input: ReportInput): Report {
  if (/^([a-zA-Z]:)?[\\/]/.test(input.root)) throw new Error("report root must be relative; absolute paths make reports differ between machines");
  const findings = [...input.findings].sort(compareFindings);
  const bySeverity: Report["summary"]["bySeverity"] = {};
  for (const severity of SEVERITIES) {
    const count = findings.filter((f) => f.severity === severity).length;
    if (count > 0) bySeverity[severity] = count;
  }
  return {
    spec: REPORT_SPEC_VERSION,
    tool: { name: "seaworthy", version: VERSION },
    root: input.root,
    summary: { pages: input.pages, findings: findings.length, bySeverity, suppressed: (input.suppressed ?? []).length, baselined: input.baselined ?? 0, baselineStale: input.baselineStale ?? 0, ...(input.changedFiles === undefined ? {} : { changedFiles: input.changedFiles }) },
    checks: input.checks
      .map((c) => ({ id: c.meta.id, title: c.meta.title, severity: c.meta.severity, needs: [...c.meta.needs], docs: c.meta.docs, standards: [...c.meta.standards] }))
      .sort((a, b) => compare(a.id, b.id)),
    findings,
    suppressed: [...(input.suppressed ?? [])].sort((a, b) => compare(a.file, b.file) || compare(a.line ?? 0, b.line ?? 0) || compare(a.checkId, b.checkId) || compare(a.fingerprint, b.fingerprint)),
    skipped: [...(input.skipped ?? [])],
    errors: [...(input.errors ?? [])],
  };
}

/** Stable JSON text of a report, ending in a newline. */
export function reportToJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}
