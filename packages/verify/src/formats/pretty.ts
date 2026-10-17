// Plain-text report for terminals and agent transcripts. No color, so it reads the same everywhere.

import type { Finding, Report, Severity } from "../types.js";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function severityCounts(report: Report): string {
  const parts: string[] = [];
  const { error, warning, note } = report.summary.bySeverity;
  if (error) parts.push(plural(error, "error"));
  if (warning) parts.push(plural(warning, "warning"));
  if (note) parts.push(plural(note, "note"));
  return parts.join(", ");
}

export function describeLocation(finding: Finding): string {
  const { line, column } = finding.location;
  if (line === undefined) return "-";
  return `${line}${column === undefined ? "" : `:${column}`}${finding.location.approximateLine ? "~" : ""}`;
}

export function formatPretty(report: Report): string {
  const path = (file: string) => (report.root === "." ? file : `${report.root}/${file}`);
  const out: string[] = [`seaworthy ${report.tool.version}: ${report.root} (${plural(report.summary.pages, "page")}, ${plural(report.checks.length, "check")})`, ""];

  let current: string | undefined;
  for (const finding of report.findings) {
    if (finding.location.file !== current) {
      if (current !== undefined) out.push("");
      current = finding.location.file;
      out.push(path(current));
    }
    out.push(`  ${describeLocation(finding).padEnd(8)}${finding.severity.padEnd(8)}${finding.checkId}  ${finding.message}`);
    out.push(`          fix: ${finding.fix.summary}`);
  }
  if (report.findings.length > 0) out.push("");

  if (report.skipped.length > 0) {
    out.push(`Skipped (${report.skipped.length}), not run:`);
    for (const s of report.skipped) out.push(`  ${s.check}: ${s.reason}. ${s.hint}`);
    out.push("");
  }
  if (report.errors.length > 0) {
    out.push(`Check errors (${report.errors.length}), these checks crashed:`);
    for (const e of report.errors) out.push(`  ${e.check}: ${e.message}`);
    out.push("");
  }

  const files = new Set(report.findings.map((f) => f.location.file)).size;
  out.push(report.findings.length === 0 ? "No findings." : `${plural(report.findings.length, "finding")} in ${plural(files, "file")}: ${severityCounts(report)}.`);
  return out.join("\n") + "\n";
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, note: 2 };
