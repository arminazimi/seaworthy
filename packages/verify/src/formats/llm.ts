// Compact plain-text report sized for an agent's context window. The fix comes
// first, then the check ID, severity, and location, then the message: an agent
// reading top to bottom gets the action before the diagnosis. One line per
// finding, grouped by file, nothing decorative, and no color, so every run
// writes the same bytes.

import type { Finding, Report } from "../types.js";
import type { Formatter } from "./base.js";
import { describeLocation } from "./pretty.js";

/** A finding is one line, so anything a check said across lines is flattened onto it. */
const oneLine = (text: string): string => text.replace(/\r?\n/g, " ");
/** Site contents are untrusted input: a `|` in them must not be able to reframe the line. */
const cell = (text: string): string => oneLine(text).replace(/\|/g, "\\|");

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `file:line:col`, or just `file` when the check found no line. */
function where(finding: Finding): string {
  if (finding.location.line === undefined) return finding.location.file;
  return `${finding.location.file}:${describeLocation(finding)}`;
}

const findingLine = (finding: Finding): string =>
  `  ${oneLine(finding.fix.summary)} | ${finding.checkId} ${finding.severity} | ${where(finding)} | ${cell(finding.message)}`;

export function formatLlm(report: Report): string {
  const out: string[] = [];
  const files = new Set(report.findings.map((f) => f.location.file)).size;
  const counts = (["error", "warning", "note"] as const)
    .map((severity) => [severity, report.summary.bySeverity[severity] ?? 0] as const)
    .filter(([, n]) => n > 0)
    .map(([severity, n]) => plural(n, severity));
  const total = report.findings.length;
  out.push(
    `seaworthy llm ${report.root}: ${plural(total, "finding")} in ${plural(files, "file")}${counts.length > 0 ? ` (${counts.join(", ")})` : ""}, ${plural(report.summary.pages, "page")}, ${plural(report.checks.length, "check")}`,
  );

  // Findings arrive sorted by file, line, column, and check ID, so everything with
  // the same file is consecutive and the order below is the report's own order.
  let current: string | undefined;
  for (const finding of report.findings) {
    if (finding.location.file !== current) {
      current = finding.location.file;
      out.push(current);
    }
    out.push(findingLine(finding));
  }

  if (report.errors.length > 0) out.push(...report.errors.map((e) => `crashed ${e.check}: ${cell(e.message)}`));
  if (report.skipped.length > 0)
    for (const s of report.skipped) out.push(s.hint === "" ? `skipped ${s.check}: ${cell(s.reason)}` : `skipped ${s.check}: ${cell(s.reason)}. ${cell(s.hint)}`);

  if (report.summary.changedFiles !== undefined) out.push(`scope: findings limited to the ${plural(report.summary.changedFiles, "file")} that changed`);
  if (report.summary.suppressed > 0) out.push(`suppressed: ${plural(report.summary.suppressed, "finding")} hidden on purpose, not shown`);
  if (report.summary.baselined > 0) out.push(`baselined: ${plural(report.summary.baselined, "finding")} accepted, not shown`);
  if (report.summary.baselineStale > 0) out.push(`baseline-stale: ${report.summary.baselineStale} baseline ${report.summary.baselineStale === 1 ? "entry" : "entries"} no longer matches anything; run --update-baseline to prune`);
  const readability = report.summary.readability;
  if (readability) out.push(`readability: ${readability.score}/100 (${readability.passed} of ${plural(readability.checks, "applicable check")} clean)`);
  return out.join("\n") + "\n";
}

export const render: Formatter = (report) => formatLlm(report);
