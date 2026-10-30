// Public contracts for checks and reports. See docs/adr/0006-check-model.md.
// Everything here is versioned by REPORT_SPEC_VERSION and changes only through an RFC once frozen.

import type { MarkdownSources } from "./markdown.js";
import type { SiteGraph } from "./site.js";
import type { SuppressedFinding } from "./suppress.js";

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

export interface BrowserContext {
  /** Path of the browser to launch. Default: `SEAWORTHY_BROWSER`, then an installed Chrome, Chromium, or Edge. */
  readonly path?: string;
}

export interface CheckContext {
  readonly site: SiteGraph;
  /** Options for this check from the config file. */
  readonly options: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  /** Set under --changed: site-relative files that changed. Expensive checks may limit themselves to these. */
  readonly changed?: ReadonlySet<string>;
  /** Set for checks that need a browser, from --browser-path. */
  readonly browser?: BrowserContext;
  /** Set from --markdown: explicit Markdown sources; the md.* graph uses these instead of walking the site folder. */
  readonly markdownSources?: MarkdownSources;
  /** Set under --evidence: where rendered checks save the crops that prove their findings. */
  readonly evidence?: EvidenceSink;
}

/**
 * Where the run's screenshot evidence goes. `dir` is the folder on the file system — the
 * user opted into it with --evidence, and it is never inside the verified folder; `label` is
 * the same folder as the report names it: relative to where the command ran, forward slashes.
 */
export interface EvidenceSink {
  readonly dir: string;
  readonly label: string;
}

/**
 * Why a check that is enabled cannot run on this machine, for example no browser installed.
 * Reported under `skipped` with its reason and hint, exactly like a capability the user did not turn on.
 */
export interface ProbeSkip {
  readonly reason: string;
  readonly hint: string;
}

export interface Check {
  readonly meta: CheckMeta;
  /**
   * Optional pre-flight: when it returns a `ProbeSkip`, the check is skipped instead of run,
   * so a rendered check on a browser-less machine is reported as skipped, never passed.
   */
  readonly probe?: (context: CheckContext) => Promise<ProbeSkip | undefined>;
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
  /** Set by a rendered check that saved its --evidence crop; carried onto the finding unchanged. */
  evidence?: FindingEvidence;
}

/** The screenshot crop that proved a rendered finding: the pixels behind the message. */
export interface FindingEvidence {
  /** Path of the image, relative to where the command ran, forward slashes; never absolute, never inside the verified site. */
  image: string;
  /** The name of the width the crop was taken at, one of the rendered checks' shared viewport names. */
  viewport: string;
}

export interface Finding {
  checkId: string;
  severity: Severity;
  message: string;
  location: Location;
  fix: Fix;
  fingerprint: string;
  /** Added in buildReport: a ready-to-paste fix prompt for an agent, identical in every output format. */
  prompt?: string;
  /** Present only for a rendered finding whose crop was saved under --evidence. */
  evidence?: FindingEvidence;
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

/** The agent-readability summary: a count of how many applicable readability checks came out clean. */
export interface Readability {
  /** Share of applicable checks with no finding, as a whole number from 0 to 100. */
  score: number;
  /** Checks that applied to this site. */
  checks: number;
  passed: number;
  withFindings: number;
}

export interface Report {
  spec: number;
  tool: { name: "seaworthy"; version: string };
  /** The folder that was verified, as given (relative), never an absolute path. */
  root: string;
  summary: {
    pages: number;
    findings: number;
    /** Counts by severity over ALL reported findings, including ones a `--max-findings` or per-check cap cut, so the exit code can be decided from it. May be larger than `findings`. */
    bySeverity: Partial<Record<Severity, number>>;
    /** Findings hidden by a live suppression. They are listed in `suppressed`, with reasons. */
    suppressed: number;
    /** Findings accepted by the baseline. */
    baselined: number;
    /** Baseline entries that no longer match anything: problems that were fixed. */
    baselineStale: number;
    /** Present when `--max-findings` or a per-check cap cut findings, or when `--new-only` dropped findings the previous run already had: how many the engine found but the report omits, in report order after the kept ones. */
    findingsOmitted?: number;
    /** Present under --changed: findings are limited to files that changed. */
    changedFiles?: number;
    /** Present when a readability check applied to the site. */
    readability?: Readability;
  };
  checks: ReportCheck[];
  findings: Finding[];
  suppressed: SuppressedFinding[];
  skipped: SkippedCheck[];
  errors: CheckError[];
  /** Added in buildReport when there are findings: one prompt that fixes everything, in report order. */
  prompt?: string;
}
