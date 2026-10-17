// Public contracts for checks and reports. See docs/adr/0006-check-model.md.
// Everything here is versioned by REPORT_SPEC_VERSION and changes only through an RFC once frozen.

import type { SiteGraph } from "./site.js";

/** SARIF levels. There is no custom severity scale. */
export type Severity = "error" | "warning" | "note";
export const SEVERITIES: readonly Severity[] = ["error", "warning", "note"];

/** What a check needs. `browser` and `network` are opt-in (ADR 0005). */
export type Needs = "html" | "files" | "browser" | "network";

export interface CheckMeta {
  /** `area.rule`: lowercase letters, digits, dots, and hyphens. Permanent once released. */
  readonly id: string;
  readonly title: string;
  /** The default severity; users can override it in config. */
  readonly severity: Severity;
  readonly needs: readonly Needs[];
  /** URL of the check's docs page. */
  readonly docs: string;
  /** Standards the rule comes from, for example `WCAG 1.4.3`. */
  readonly standards: readonly string[];
}

export interface CheckContext {
  readonly site: SiteGraph;
  /** Options for this check from the config file. */
  readonly options: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface Check {
  readonly meta: CheckMeta;
  run(context: CheckContext): AsyncIterable<FindingDraft> | Iterable<FindingDraft>;
}

export interface Location {
  /** Relative to the site root, forward slashes. */
  file: string;
  /** 1-based. */
  line?: number;
  /** 1-based, in UTF-16 code units. */
  column?: number;
  /** True when the line was found by searching for the snippet rather than from the parser. */
  approximateLine?: boolean;
  /** CSS selector, for rendered checks. */
  selector?: string;
  snippet?: string;
}

/** A text-anchored edit: replace an exact string on one line. Insert and delete are replaces. */
export interface Edit {
  file: string;
  line: number;
  action: "replace";
  find: string;
  replace: string;
  /** A human or agent must supply content, such as alt text. */
  needsInput?: boolean;
}

export interface Fix {
  kind: "edit" | "manual";
  summary: string;
  edits: Edit[];
  /** Findings point at built output; agents translate the fix to source files. */
  appliesTo: "built-output";
}

/** What a check yields. The engine adds the check ID, default severity, and fingerprint. */
export interface FindingDraft {
  message: string;
  location: Location;
  fix: { kind: Fix["kind"]; summary: string; edits?: Edit[] };
  /** Stable identity for the fingerprint: an href, an image src, a selector. Never a line number. */
  key: string;
  /** Overrides the check's default severity. */
  severity?: Severity;
}

export interface Finding {
  checkId: string;
  severity: Severity;
  message: string;
  location: Location;
  fix: Fix;
  fingerprint: string;
}

export interface SkippedCheck {
  check: string;
  reason: string;
  hint: string;
}

export interface CheckError {
  check: string;
  message: string;
}

export interface ReportCheck extends CheckMeta {}

export interface Report {
  spec: number;
  tool: { name: "seaworthy"; version: string };
  /** The folder that was verified, as given (relative), never an absolute path. */
  root: string;
  summary: {
    pages: number;
    findings: number;
    bySeverity: Partial<Record<Severity, number>>;
  };
  checks: ReportCheck[];
  findings: Finding[];
  skipped: SkippedCheck[];
  errors: CheckError[];
}
