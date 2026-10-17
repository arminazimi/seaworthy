// Markdown report for pull request comments and agent chats. Capped so it fits a GitHub comment.

import type { Report } from "../types.js";
import { describeLocation, severityCounts } from "./pretty.js";

export const MAX_MARKDOWN_ROWS = 50;

const cell = (text: string): string => text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

export function formatMarkdown(report: Report): string {
  const files = new Set(report.findings.map((f) => f.location.file)).size;
  const total = report.findings.length;
  const out: string[] = [];
  out.push(total === 0 ? "## Seaworthy: no findings" : `## Seaworthy: ${total} finding${total === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}`, "");
  out.push(`${code(report.root)}: ${report.summary.pages} page${report.summary.pages === 1 ? "" : "s"}, ${report.checks.length} check${report.checks.length === 1 ? "" : "s"}${total > 0 ? `. ${severityCounts(report)}.` : "."}`, "");

  const notes: string[] = [];
  if (report.summary.changedFiles !== undefined) notes.push(`Scope: findings in the ${report.summary.changedFiles} file${report.summary.changedFiles === 1 ? "" : "s"} that changed.`);
  if (report.summary.suppressed > 0) notes.push(`${report.summary.suppressed} suppressed on purpose.`);
  if (report.summary.baselined > 0) notes.push(`${report.summary.baselined} accepted by the baseline.`);
  if (report.summary.baselineStale > 0) notes.push(`${report.summary.baselineStale} baseline ${report.summary.baselineStale === 1 ? "entry" : "entries"} fixed: run \`--update-baseline\` to prune.`);
  if (notes.length > 0) out.push(notes.join(" "), "");

  if (total > 0) {
    const shown = report.findings.slice(0, MAX_MARKDOWN_ROWS);
    out.push("| Severity | Check | Location | Problem |", "| --- | --- | --- | --- |");
    for (const f of shown) out.push(`| ${f.severity} | ${code(f.checkId)} | ${code(`${f.location.file}:${describeLocation(f)}`)} | ${cell(f.message)} |`);
    out.push("");
    out.push("**How to fix**", "");
    for (const f of shown) out.push(`- ${code(`${f.location.file}:${describeLocation(f)}`)} ${cell(f.fix.summary)}`);
    if (total > shown.length) out.push("", `...and ${total - shown.length} more. Run \`seaworthy verify --format json\` for the full report.`);
    out.push("");
  }
  if (report.skipped.length > 0) {
    out.push("**Skipped, not run**", "");
    for (const s of report.skipped) out.push(`- ${code(s.check)}: ${cell(s.reason)}. ${cell(s.hint)}`);
    out.push("");
  }
  if (report.errors.length > 0) {
    out.push("**Check errors, these checks crashed**", "");
    for (const e of report.errors) out.push(`- ${code(e.check)}: ${cell(e.message)}`);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
