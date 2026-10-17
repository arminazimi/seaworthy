// Suppressions: findings a person decided to live with, each with a required reason and an optional expiry.
// An expired suppression stops applying and is reported, so suppressions cannot quietly rot.
//
// Inline, in the built HTML (the comment covers its own line and the next):
//   <!-- seaworthy-ignore images.alt links.*: decorative sprite, tracked in #123 until 2027-03-01 -->
// In seaworthy.config.json: "suppressions": [{ "check", "file" and/or "fingerprint", "reason", "expires" }]

import type { ConfigSuppression } from "./config.js";
import { fingerprint } from "./engine.js";
import { matchesCheck, matchesGlob } from "./glob.js";
import type { SiteGraph } from "./site.js";
import type { Check, Finding } from "./types.js";

export const SUPPRESSION_CHECKS: readonly Check[] = [
  {
    meta: { id: "suppress.invalid", title: "A seaworthy-ignore comment is malformed", severity: "error", needs: ["html"], docs: "https://github.com/arminazimi/seaworthy/blob/main/docs/checks/suppress.invalid.md", standards: [] },
    run: () => [], // findings come from parseInlineSuppressions, which needs the set of known check IDs
  },
  {
    meta: { id: "suppress.expired", title: "A suppression has expired", severity: "warning", needs: ["html"], docs: "https://github.com/arminazimi/seaworthy/blob/main/docs/checks/suppress.expired.md", standards: [] },
    run: () => [],
  },
];

export interface Suppression {
  source: "inline" | "config";
  /** Check ID or prefix pattern. */
  checks: string[];
  reason: string;
  expires?: string;
  /** Site-relative file or glob. */
  file?: string;
  fingerprint?: string;
  /** Inline only: the comment's line; it covers this line and the next. */
  line?: number;
  /** Where the suppression is written, for reports about it. */
  origin: { file: string; line?: number };
}

export interface SuppressedFinding {
  checkId: string;
  fingerprint: string;
  file: string;
  line?: number;
  reason: string;
  source: "inline" | "config";
  expires?: string;
}

const COMMENT = /<!--\s*seaworthy-ignore\b([\s\S]*?)-->/g;
const SYNTAX = /^\s+([a-z0-9.*,\s-]+?)\s*:\s*([\s\S]+?)\s*$/;
const UNTIL = /\s+until\s+(\d{4}-\d{2}-\d{2})\s*$/;

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

const problem = (checkId: "suppress.invalid" | "suppress.expired", file: string, line: number | undefined, message: string, summary: string, key: string): Finding => ({
  checkId,
  severity: checkId === "suppress.invalid" ? "error" : "warning",
  message,
  location: line === undefined ? { file } : { file, line },
  fix: { kind: "manual", summary, edits: [], appliesTo: "built-output" },
  fingerprint: fingerprint(checkId, file, key),
});

/** Finds `seaworthy-ignore` comments. Malformed ones become `suppress.invalid` findings. */
export function parseInlineSuppressions(site: SiteGraph, knownCheckIds: readonly string[]): { suppressions: Suppression[]; problems: Finding[] } {
  const suppressions: Suppression[] = [];
  const problems: Finding[] = [];
  for (const page of site.pages.values()) {
    for (const match of page.source.matchAll(COMMENT)) {
      const line = lineOf(page.source, match.index ?? 0);
      const body = match[1] ?? "";
      const syntax = SYNTAX.exec(body);
      const fail = (why: string) =>
        problems.push(problem("suppress.invalid", page.file, line, `The seaworthy-ignore comment is malformed: ${why}.`, "Write it as <!-- seaworthy-ignore check.id: reason --> or <!-- seaworthy-ignore check.id: reason until 2027-03-01 -->.", `${line}:${body.trim()}`));
      if (!syntax) {
        fail("it needs check IDs, a colon, and a reason");
        continue;
      }
      const ids = (syntax[1] as string).split(/[\s,]+/).filter(Boolean);
      let reason = (syntax[2] as string).trim();
      let expires: string | undefined;
      const until = UNTIL.exec(reason);
      if (until) {
        expires = until[1] as string;
        reason = reason.slice(0, until.index).trim();
        if (Number.isNaN(Date.parse(`${expires}T00:00:00Z`))) {
          fail(`"${expires}" is not a real date`);
          continue;
        }
      }
      const unknown = ids.filter((id) => !knownCheckIds.some((known) => matchesCheck(id, known)));
      if (unknown.length > 0) {
        fail(`unknown check ID ${unknown.join(", ")}`);
        continue;
      }
      if (reason.length < 3) {
        fail("a reason is required");
        continue;
      }
      suppressions.push({ source: "inline", checks: ids, reason, ...(expires ? { expires } : {}), file: page.file, line, origin: { file: page.file, line } });
    }
  }
  return { suppressions, problems };
}

export function fromConfig(entries: readonly ConfigSuppression[], configFile: string): Suppression[] {
  return entries.map((e) => ({
    source: "config" as const,
    checks: [e.check],
    reason: e.reason,
    ...(e.expires ? { expires: e.expires } : {}),
    ...(e.file ? { file: e.file } : {}),
    ...(e.fingerprint ? { fingerprint: e.fingerprint } : {}),
    origin: { file: configFile },
  }));
}

const isExpired = (expires: string | undefined, now: Date): boolean => expires !== undefined && now.getTime() >= Date.parse(`${expires}T00:00:00Z`) + 24 * 60 * 60 * 1000;

function covers(s: Suppression, finding: Finding): boolean {
  if (!s.checks.some((pattern) => matchesCheck(pattern, finding.checkId))) return false;
  if (s.fingerprint !== undefined && s.fingerprint !== finding.fingerprint) return false;
  if (s.source === "inline") {
    const line = finding.location.line;
    return finding.location.file === s.file && line !== undefined && s.line !== undefined && (line === s.line || line === s.line + 1);
  }
  return s.file === undefined || matchesGlob(s.file, finding.location.file);
}

export interface SuppressionResult {
  findings: Finding[];
  suppressed: SuppressedFinding[];
  /** Expired suppressions, as findings. */
  expired: Finding[];
}

/** Drops findings covered by a live suppression. Expired suppressions do not apply and are reported. */
export function applySuppressions(findings: readonly Finding[], suppressions: readonly Suppression[], now: Date): SuppressionResult {
  const live = suppressions.filter((s) => !isExpired(s.expires, now));
  const expired = suppressions
    .filter((s) => isExpired(s.expires, now))
    .map((s) =>
      problem(
        "suppress.expired",
        s.origin.file,
        s.origin.line,
        `The suppression for ${s.checks.join(", ")} expired on ${s.expires}: ${s.reason}`,
        "Fix the underlying problem and remove the suppression, or extend the date with a new reason.",
        `${s.checks.join(",")}:${s.file ?? ""}:${s.fingerprint ?? ""}:${s.expires}`,
      ),
    );
  const kept: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];
  for (const finding of findings) {
    const by = live.find((s) => covers(s, finding));
    if (!by) kept.push(finding);
    else
      suppressed.push({
        checkId: finding.checkId,
        fingerprint: finding.fingerprint,
        file: finding.location.file,
        ...(finding.location.line === undefined ? {} : { line: finding.location.line }),
        reason: by.reason,
        source: by.source,
        ...(by.expires ? { expires: by.expires } : {}),
      });
  }
  return { findings: kept, suppressed, expired };
}
