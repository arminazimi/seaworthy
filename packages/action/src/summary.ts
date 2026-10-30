// The job-summary pieces of the Seaworthy GitHub Action (issue #260, `action.job-summary`).
//
// A job summary is the markdown a step appends to `$GITHUB_STEP_SUMMARY`, which GitHub renders on
// the run page. It is a different channel from the pull-request comment (issues #89 and #375,
// ./pr-comment.ts and ./trend.ts): that one posts to the PR and compares two runs, this one shows
// the single run the Action just did and never posts anything. Neither module writes the other's
// file, and a workflow that turns this one off keeps exactly the comment behaviour it has today.
//
// Everything below is pure except `writeJobSummary`, whose only side effect is appending to the file
// the runner names. The counts are read from the report contract's own `summary` fields
// (spec/report/fragments/summary, `Report.summary` in @seaworthy/verify); nothing here re-counts
// findings to decide a number, and a number the report does not carry is left out rather than shown
// as a made-up zero. The report JSON is untrusted input: parsed, never evaluated.

import { appendFileSync } from "node:fs";

import { SEVERITIES, type Finding, type Report, type Severity } from "@seaworthy/verify";

import { badgeForReport, README_SNIPPET } from "./badge-svg.js";

/** How many findings the summary lists; the rest are reported as a count, never silently dropped. */
export const TOP_FINDINGS = 10;

/** The environment variable the runner sets when a job summary is available. */
export const SUMMARY_ENV = "GITHUB_STEP_SUMMARY";

/** Code-point order, never locale order: the same report renders the same bytes on every runner. */
/** Code-point order, never locale order: the same report renders the same bytes on every runner. */
const before = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The same as a sign, so a tie-break of a big gap reads the same as a tie-break of a small one. */
const byNumber = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

/** The severity ranks the top-findings rule sorts by; the order is the CLI gate's own. */
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, note: 2 };

/**
 * The frozen top-findings rule, in one comparator:
 *
 *   severity (error, then warning, then note) → check ID → file → line → column → fingerprint
 *
 * so "worst first" is decided by severity alone, and everything after it is a tie-break that makes
 * the order total. A missing line sorts after every line (it cannot be placed), a missing column
 * sorts as 0. Two findings equal in all of these keep the report's own order, because Array.sort is
 * stable: identical input always renders identical bytes.
 */
export function compareTopFindings(a: Finding, b: Finding): number {
  return (
    byNumber(SEVERITY_RANK[a.severity], SEVERITY_RANK[b.severity]) ||
    before(a.checkId, b.checkId) ||
    before(a.location.file, b.location.file) ||
    byNumber(a.location.line ?? Number.MAX_SAFE_INTEGER, b.location.line ?? Number.MAX_SAFE_INTEGER) ||
    byNumber(a.location.column ?? 0, b.location.column ?? 0) ||
    before(a.fingerprint, b.fingerprint)
  );
}

/** The findings in top-findings order; the caller caps the list it renders. */
export function topFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareTopFindings);
}

/**
 * Table-safe text: newlines become spaces, `|` is escaped so it cannot end the cell, and a backtick
 * is escaped so an unmatched one cannot open a code span over the rest of the row.
 */
export function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").replace(/`/g, "\\`");
}

/**
 * A value in backticks, the way the Markdown report already shows a check ID or a path. A pipe is
 * escaped first, because a table row is split on pipes before inline parsing, so even `` `a|b` ``
 * would otherwise buy a new cell. A backtick inside a code span cannot be escaped, so it is
 * replaced, matching `packages/verify/src/formats/markdown.ts`.
 */
export function inlineCode(text: string): string {
  return "`" + text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").replace(/`/g, "'") + "`";
}

/** A whole count from untrusted JSON, or undefined when the report does not carry one. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The findings the report actually describes; a malformed entry is left out, never guessed at. */
function asFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Finding => {
    const f = entry as Partial<Finding> | null;
    return (
      f !== null &&
      typeof f === "object" &&
      typeof f.checkId === "string" &&
      typeof f.message === "string" &&
      typeof f.fingerprint === "string" &&
      SEVERITIES.includes(f.severity as Severity) &&
      typeof f.location?.file === "string"
    );
  });
}

/** The location cell: `file:line:column`, with whatever the report gives; a bare file stays bare. */
function locationOf(finding: Finding): string {
  const { file, line, column } = finding.location;
  return [file, line, column].filter((part) => part !== undefined).join(":");
}

/** The severity counts the report carries, in the contract's own order; a missing severity is absent, not 0. */
function severityParts(bySeverity: Record<string, unknown>): string[] {
  return SEVERITIES.map((severity) => {
    const n = count(bySeverity[severity]);
    return n === undefined || n === 0 ? undefined : plural(n, severity);
  }).filter((part): part is string => part !== undefined);
}

/** The badge line and the README snippet, from the report's own counts; nothing is invented. */
function badgeSection(report: unknown): string[] {
  let badge: ReturnType<typeof badgeForReport>;
  try {
    badge = badgeForReport(report);
  } catch {
    // The badge has no rule for this report; the summary loses the section and the run loses nothing.
    return [];
  }
  const shown = badge.count === undefined ? `\`${badge.state}\`` : `\`${badge.state}\` (${badge.count})`;
  return [
    "### Badge",
    "",
    `The state \`seaworthy-badge\` builds from this report: ${shown}. Once the badge SVG is committed, this is the snippet for a README (\`seaworthy-badge --readme\`, [docs/badge.md](https://github.com/arminazimi/seaworthy/blob/main/docs/badge.md)):`,
    "",
    "```markdown",
    README_SNIPPET,
    "```",
    "",
  ];
}

/**
 * The job summary for one verify report: the counts the contract carries, the top findings in the
 * frozen order, the crashed checks, and the badge. Returns "" for JSON that is not a Seaworthy
 * report, so the caller writes nothing at all rather than a half page.
 *
 * `site` names which built folder this report is for. A single-site run needs no label; a
 * multi-site run appends one section per site to the same file, and the heading is what keeps the
 * sections apart.
 */
export function jobSummary(report: unknown, site?: string): string {
  const r = report as Partial<Report> & { summary?: Record<string, unknown> } | null;
  if (typeof r !== "object" || r === null || r.tool?.name !== "seaworthy") return "";
  const summary: Record<string, unknown> = typeof r.summary === "object" && r.summary !== null ? (r.summary as Record<string, unknown>) : {};
  const root = text(r.root);
  const pages = count(summary.pages);
  const findings = count(summary.findings);
  const bySeverity = typeof summary.bySeverity === "object" && summary.bySeverity !== null ? (summary.bySeverity as Record<string, unknown>) : {};
  const severities = severityParts(bySeverity);

  const out: string[] = [site === undefined || site === "" ? "## Seaworthy" : `## Seaworthy · \`${site}\``, ""];
  const counted: string[] = [];
  if (pages !== undefined) counted.push(plural(pages, "page"));
  if (findings !== undefined) counted.push(findings === 0 ? "no findings" : plural(findings, "finding"));
  const countsLine = counted.length === 0 ? "" : `${counted.join(", ")}${severities.length > 0 ? `: ${severities.join(", ")}` : ""}.`;
  if (root !== undefined || countsLine !== "") out.push(`${root === undefined ? "" : `${inlineCode(root)} — `}${countsLine}`, "");

  // One note per summary field that is there, in the contract's own wording.
  const notes: string[] = [];
  const suppressed = count(summary.suppressed);
  if (suppressed !== undefined && suppressed > 0) notes.push(`${plural(suppressed, "finding")} suppressed on purpose.`);
  const baselined = count(summary.baselined);
  if (baselined !== undefined && baselined > 0) notes.push(`${plural(baselined, "finding")} accepted by the baseline.`);
  const stale = count(summary.baselineStale);
  if (stale !== undefined && stale > 0) notes.push(`${stale} baseline ${stale === 1 ? "entry" : "entries"} fixed: run \`seaworthy verify --update-baseline\` to prune.`);
  const omitted = count(summary.findingsOmitted);
  if (omitted !== undefined && omitted > 0) notes.push(`${omitted} more ${omitted === 1 ? "finding is" : "findings are"} left out of this report (a findings cap or \`--new-only\`); the severity counts above include them.`);
  const changedFiles = count(summary.changedFiles);
  if (changedFiles !== undefined) notes.push(`Findings are limited to the ${plural(changedFiles, "file")} that changed.`);
  const readability = summary.readability as Report["summary"]["readability"];
  if (readability !== undefined && typeof readability === "object") {
    notes.push(`Agent readability: ${readability.score}/100 (${readability.passed} of ${plural(readability.checks, "applicable check")} clean).`);
  }
  if (notes.length > 0) out.push(...notes.map((note) => `- ${note}`), "");

  const listed = asFindings(r.findings);
  if (listed.length > 0) {
    const shown = topFindings(listed).slice(0, TOP_FINDINGS);
    out.push("### Top findings", "", `Worst first: severity, then check ID, then location. At most ${TOP_FINDINGS} are listed.`, "", "| Severity | Check | Location | Problem |", "| --- | --- | --- | --- |");
    for (const finding of shown) out.push(`| ${finding.severity} | ${inlineCode(finding.checkId)} | ${inlineCode(locationOf(finding))} | ${escapeCell(finding.message)} |`);
    const rest = listed.length - shown.length;
    if (rest > 0) out.push("", `...and ${plural(rest, "more finding")}. Run \`seaworthy verify --format json\` for the full report.`);
    out.push("");
  }

  if (Array.isArray(r.errors) && r.errors.length > 0) {
    out.push("### Checks that crashed", "");
    for (const entry of r.errors) {
      const e = entry as { check?: unknown; message?: unknown };
      const check = text(e?.check);
      if (check === undefined) continue;
      out.push(`- ${inlineCode(check)}: ${escapeCell(text(e?.message) ?? "")}`);
    }
    out.push("");
  }

  out.push(...badgeSection(report));
  out.push("_Seaworthy is pre-alpha. This job summary reports the run; the verdict is the verify step's exit code (0 clean, 1 findings at or above the threshold, 2 a usage error, 4 a crash)._", "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Appends the summary to the file the runner names. Never throws and returns false when there is no
 * summary file, the input is empty, or the write fails: a lost summary must not fail a verification,
 * so the caller keeps the CLI's exit code whatever this returns.
 */
export function writeJobSummary(markdown: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const file = env[SUMMARY_ENV];
  if (markdown === "" || file === undefined || file === "") return false;
  try {
    appendFileSync(file, markdown, "utf8");
    return true;
  } catch {
    return false;
  }
}
