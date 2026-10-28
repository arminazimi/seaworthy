// Plain-text report for terminals and agent transcripts. Color is applied only
// when the caller paints terms (the CLI only paints when stdout is a TTY), so
// files, pipes, and agent transcripts keep reading the same everywhere.

import { PLAIN, type Palette } from "../color.js";
import type { Finding, Report, Severity } from "../types.js";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function severityCounts(report: Report, paint: Palette = PLAIN): string {
  const { error, warning, note } = report.summary.bySeverity;
  const parts: string[] = [];
  if (error) parts.push(paint.error(plural(error, "error")));
  if (warning) parts.push(paint.warning(plural(warning, "warning")));
  if (note) parts.push(paint.note(plural(note, "note")));
  return parts.join(", ");
}

/** One line for the agent-readability summary, or undefined when the report has none. */
export function readabilityLine(report: Report): string | undefined {
  const r = report.summary.readability;
  return r ? `Agent readability: ${r.score}/100 (${r.passed} of ${plural(r.checks, "applicable check")} clean).` : undefined;
}

export function describeLocation(finding: Finding): string {
  const { line, column } = finding.location;
  if (line === undefined) return "-";
  return `${line}${column === undefined ? "" : `:${column}`}${finding.location.approximateLine ? "~" : ""}`;
}

export function formatPretty(report: Report, paint: Palette = PLAIN): string {
  const path = (file: string) => (report.root === "." ? file : `${report.root}/${file}`);
  const out: string[] = [`seaworthy ${report.tool.version}: ${report.root} (${plural(report.summary.pages, "page")}, ${plural(report.checks.length, "check")})`, ""];

  let current: string | undefined;
  for (const finding of report.findings) {
    if (finding.location.file !== current) {
      if (current !== undefined) out.push("");
      current = finding.location.file;
      out.push(path(current));
    }
    out.push(`  ${describeLocation(finding).padEnd(8)}${paint[finding.severity](finding.severity.padEnd(8))}${finding.checkId}  ${finding.message}`);
    out.push(`          fix: ${finding.fix.summary}`);
    if (finding.prompt !== undefined) out.push(`          prompt: ${finding.prompt}`);
  }
  if (report.findings.length > 0) out.push("");

  if (report.skipped.length > 0) {
    out.push(`Skipped (${report.skipped.length}), not run:`);
    for (const s of report.skipped) out.push(`  ${s.check}: ${s.reason}. ${s.hint}`);
    out.push("");
  }
  if (report.errors.length > 0) {
    out.push(paint.error(`Check errors (${report.errors.length}), these checks crashed:`));
    for (const e of report.errors) out.push(`  ${e.check}: ${e.message}`);
    out.push("");
  }

  if (report.summary.changedFiles !== undefined) out.push(`Scope: findings in the ${plural(report.summary.changedFiles, "file")} that changed. Run without --changed to check everything.`, "");
  if (report.summary.suppressed > 0) out.push(`${plural(report.summary.suppressed, "finding")} suppressed on purpose (see "suppressed" in the JSON report).`);
  if (report.summary.baselined > 0) out.push(`${plural(report.summary.baselined, "finding")} accepted by the baseline.`);
  if (report.summary.baselineStale > 0) out.push(`${plural(report.summary.baselineStale, "baseline entry")} no longer match anything: fixed. Run --update-baseline to prune.`);
  if (report.summary.findingsOmitted !== undefined) out.push(`${plural(report.summary.findingsOmitted, "finding")} beyond the findings cap are omitted from the list above (see "findingsOmitted" in the JSON report). Raise the cap with --max-findings.`);
  const readability = readabilityLine(report);
  if (readability) out.push(readability);
  const files = new Set(report.findings.map((f) => f.location.file)).size;
  out.push(report.findings.length === 0 ? paint.ok("No findings.") : `${plural(report.findings.length, "finding")} in ${plural(files, "file")}: ${severityCounts(report, paint)}.`);
  if (report.prompt !== undefined) {
    out.push("", "Prompt to fix every finding at once (paste it into an agent):");
    for (const line of report.prompt.split("\n")) out.push(`  ${line}`);
  }
  return out.join("\n") + "\n";
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, note: 2 };
