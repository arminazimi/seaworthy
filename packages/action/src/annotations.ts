// Inline pull-request annotations for findings in tracked files (issue #259, epic E-action).
//
// The route: GitHub workflow commands (`::error file=…,line=…::message`), written to the step's own
// stdout by the `Verify the site` step that already runs `packages/action/dist/run.js`. The SARIF
// path stays exactly as it is (`sarif` input plus the artifact upload step); it answers a different
// question — a code-scanning alert that outlives the run — and needs the `security-events` permission
// plus an uploader we cannot exercise offline. A workflow command needs neither, is read by the runner
// itself, and its whole contract (level, file, line, escaping) is testable in `npm test`.
//
// The Action stays a thin adapter (AGENTS.md): nothing here re-implements a check, a severity rule, or
// the SARIF mapping of ADR 0008. It maps report JSON findings that ALREADY carry a file and a line to
// the annotation syntax GitHub renders, and it decides the one thing only the runner knows — whether
// that file and line exist in this repository checkout.
//
// The rule for "in tracked files", all four clauses of it:
//
//   1. the finding has a real line: `location.line` is a whole number of at least 1. A page-level
//      finding without a line, and a rendered finding located by `selector` alone (a11y.axe), never
//      become inline annotations — GitHub would pin them to line 1, which is a phantom location.
//   2. the site-relative path (`<report root>/<finding file>`, the same join the SARIF mapping uses,
//      minus its URI encoding) is in the set of files the pull request touched, read from
//      `git diff --name-only <base>...HEAD` — the three-dot range, so files another pull request
//      changed on the base branch are not blamed on this one. A file the author did not touch never
//      gets an annotation, and a file they only deleted cannot appear (a diff range lists it, but
//      clause 3 rejects it because its lines are gone).
//   3. the line exists in the checked-out file: the file is readable under the workspace, inside it,
//      and the line number is within its line count. Never a guessed line.
//   4. the annotation budget: at most `MAX_ANNOTATIONS` inline annotations per run, errors first.
//
// Anything clause 1, 2, 3 or 4 leaves out is listed in the summary channel instead — the step summary
// when the runner provides one, the step log otherwise — so no finding is ever silently dropped.
//
// Git runs offline against the checkout the workflow already has: no network, no token, no API. When
// the base ref is not in the shallow default checkout, the pull-request context is unavailable, every
// finding goes to the summary with the reason, and the run's verdict is untouched.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Finding, Severity } from "@seaworthy/verify";

/**
 * The annotation level for each severity of the report contract (`packages/verify/src/types.ts`:
 * `error`, `warning`, `note`). GitHub renders these three commands and nothing else; `note` is the
 * runner's `notice` level, so no fourth severity is invented and none is dropped.
 */
export const ANNOTATION_LEVEL: Readonly<Record<Severity, "error" | "warning" | "notice">> = {
  error: "error",
  warning: "warning",
  note: "notice",
};

/**
 * Inline annotations per run. A site with a real problem reports far more findings than a person reads
 * on one pull request, and 300 warnings on one diff buries the errors; the rest are counted and
 * summarized. Deliberately a local cap rather than the CLI's `--max-findings`, because that cap cuts
 * the report itself and the report is the contract the SARIF path and the PR comment read.
 */
export const MAX_ANNOTATIONS = 50;

/** How many of the summarized findings the summary channel lists; the remainder is counted. */
export const SUMMARY_LIST_MAX = 25;

/** Why a finding did not become an inline annotation, as a stable code the tests and the summary share. */
export type SkipReason = "no-location" | "not-touched" | "not-in-checkout" | "over-cap" | "unknown-changed";

/** The summary's wording for each reason. */
export const SKIP_REASON_TEXT: Readonly<Record<SkipReason, string>> = {
  "no-location": "the finding has no line in a file (a page-level or selector-only location)",
  "not-touched": "the pull request does not touch this file",
  "not-in-checkout": "the line is not in the checked-out file",
  "over-cap": `past the inline annotation budget for this run (at most ${MAX_ANNOTATIONS})`,
  "unknown-changed": "this run could not read which files the pull request touches, so nothing is safe to mark inline",
};

// GitHub's reserved characters in workflow-command data and parameter values. The runner decodes
// %25, %0D, %0A back and, for values, %5D (`]`, which would close the parameter list) and %3A (`:`,
// which separates a parameter name from its value). One pass over a table, so an escaped `%` of its
// own is never escaped twice.
const DATA_RESERVED = /[%\r\n]/g;
const PROPERTY_RESERVED = /[%\r\n\]:]/g;
const HEX: Readonly<Record<string, string>> = { "%": "%25", "\r": "%0D", "\n": "%0A", "]": "%5D", ":": "%3A" };

const escapeWith =
  (reserved: RegExp) =>
  (value: string): string =>
    value.replace(reserved, (character) => HEX[character] as string);

/** A finding message as workflow-command data: newlines and percent signs cannot break out of the command. */
export const escapeMessage = escapeWith(DATA_RESERVED);

/** A file path as a workflow-command parameter value: also `]` and `:`, which the runner would re-parse. */
export const escapeProperty = escapeWith(PROPERTY_RESERVED);

/** The annotation text: the check ID, the finding's own message, and its fix hint. */
export function annotationText(finding: Finding): string {
  const fix = finding.fix.summary.trim();
  return fix === "" ? `${finding.checkId}: ${finding.message}` : `${finding.checkId}: ${finding.message} Fix: ${fix}`;
}

/** The whole command, escaping the path and the data; the caller has already proven the line is real. */
export function annotationCommand(finding: Finding, path: string, line: number, column: number | undefined): string {
  const level = ANNOTATION_LEVEL[finding.severity];
  const parameters = [`file=${escapeProperty(path)}`, `line=${line}`];
  if (column !== undefined && Number.isInteger(column) && column >= 1) parameters.push(`col=${column}`);
  return `::${level} ${parameters.join(",")}::${escapeMessage(annotationText(finding))}`;
}

/**
 * The path of a finding as the repository and git name it: the report root joined with the site-relative
 * file, forward slashes, exactly the join `sarifUri` uses in the CLI's SARIF mapping without its URI
 * encoding. A report root of `.` means the site is the workspace itself.
 */
export function repoPath(root: string, file: string): string {
  if (file === "") return root === "." ? "" : root;
  return root === "." ? file : `${root.replace(/^\.\//, "")}/${file}`;
}

const hasRealLine = (finding: Finding): boolean => {
  const line = finding.location.line;
  return typeof line === "number" && Number.isInteger(line) && line >= 1;
};

const severityRank: Readonly<Record<Severity, number>> = { error: 0, warning: 1, note: 2 };

export interface AnnotationPlan {
  /** The inline annotations, errors first, then warnings, then notes, in report order inside a level. */
  annotations: PlannedAnnotation[];
  /** Everything else, in report order, with the reason it is not inline. */
  summarized: SummarizedFinding[];
}

export interface PlannedAnnotation {
  finding: Finding;
  /** The repository-relative path the annotation names. */
  path: string;
  line: number;
  command: string;
}

export interface SummarizedFinding {
  finding: Finding;
  path: string;
  reason: SkipReason;
}

export interface AnnotationPlanInput {
  /** The report root, as the report gives it (relative). */
  root: string;
  findings: readonly Finding[];
  /** Repository-relative files the pull request touches, or null when this run has no usable pull-request context. */
  changed: ReadonlySet<string> | null;
  /** True when `path` is a file inside the checkout and `line` is one of its lines. Never guesses. */
  lineInCheckout: (path: string, line: number) => boolean;
  /** Inline annotation budget. Defaults to `MAX_ANNOTATIONS`. */
  max?: number;
}

/**
 * Splits findings into inline annotations and the summary channel. Deterministic: the report's own
 * order decides within a level, and levels are ordered error, warning, note, so the same report always
 * produces the same commands and the same first `max` of them.
 */
export function planAnnotations(input: AnnotationPlanInput): AnnotationPlan {
  const max = input.max ?? MAX_ANNOTATIONS;
  const annotations: PlannedAnnotation[] = [];
  // Report positions are remembered, because the cap is applied after the levels are ordered and the
  // summary channel has to stay in the report's own order whatever the cap did.
  const summarized: { entry: SummarizedFinding; order: number }[] = [];
  const annotatable: { finding: Finding; path: string; line: number; order: number }[] = [];

  for (const [order, finding] of input.findings.entries()) {
    const path = repoPath(input.root, finding.location.file);
    const push = (reason: SkipReason) => summarized.push({ entry: { finding, path, reason }, order });
    if (!hasRealLine(finding)) {
      push("no-location");
      continue;
    }
    // Clause 2 before clause 3: reading a file the pull request never touched would be work for
    // nothing, and the reason the author wants is "this pull request did not change it". An
    // unreadable file list is its own reason — nothing here claims a finding is out of scope
    // when the scope is simply unknown.
    if (input.changed === null) {
      push("unknown-changed");
      continue;
    }
    if (!input.changed.has(path)) {
      push("not-touched");
      continue;
    }
    const line = finding.location.line as number;
    if (!input.lineInCheckout(path, line)) {
      push("not-in-checkout");
      continue;
    }
    annotatable.push({ finding, path, line, order });
  }

  annotatable.sort((a, b) => severityRank[a.finding.severity] - severityRank[b.finding.severity]);
  for (const [index, entry] of annotatable.entries()) {
    if (index >= max) {
      summarized.push({ entry: { finding: entry.finding, path: entry.path, reason: "over-cap" }, order: entry.order });
      continue;
    }
    annotations.push({ finding: entry.finding, path: entry.path, line: entry.line, command: annotationCommand(entry.finding, entry.path, entry.line, entry.finding.location.column) });
  }
  return { annotations, summarized: summarized.sort((a, b) => a.order - b.order).map((entry) => entry.entry) };
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** One summary line for a finding that is not inline: where it is, what it says, and why. */
export function summaryLine(entry: SummarizedFinding): string {
  const { finding } = entry;
  const at = finding.location.line === undefined ? entry.path : `${entry.path}:${finding.location.line}`;
  const message = finding.message.replace(/\s+/g, " ").trim();
  return `- \`${at}\` ${finding.severity} \`${finding.checkId}\`: ${message} (${SKIP_REASON_TEXT[entry.reason]})`;
}

export interface SummaryInput {
  /** How many findings did become inline annotations. */
  annotated: number;
  /** Why the pull-request file list was unavailable, when it was; stated once, above the list. */
  unavailable?: string;
  /** How many summarized findings to list before counting the rest. Defaults to `SUMMARY_LIST_MAX`. */
  listMax?: number;
}

/**
 * The summary channel as markdown: counts, the reason the pull-request file list was unavailable when
 * it was, then the findings that did not become annotations. Empty when there is nothing to say, so a
 * run with every finding annotated leaves the summary alone.
 */
export function summarySection(plan: AnnotationPlan, input: SummaryInput): string {
  const { summarized } = plan;
  if (summarized.length === 0 && input.unavailable === undefined) return "";
  const listMax = input.listMax ?? SUMMARY_LIST_MAX;
  const lines = ["## Seaworthy inline annotations", ""];
  if (input.annotated > 0 || summarized.length > 0) {
    lines.push(`${plural(input.annotated, "finding")} annotated inline; ${plural(summarized.length, "finding")} reported here only.`);
  }
  if (input.unavailable !== undefined) lines.push("", `Inline annotations need the files this pull request touched. ${input.unavailable}.`);
  if (summarized.length > 0) {
    lines.push("", ...summarized.slice(0, listMax).map(summaryLine));
    if (summarized.length > listMax) lines.push("", `${plural(summarized.length - listMax, "more finding")} in the same situation.`);
  }
  return lines.join("\n") + "\n";
}

/** Runs git in the checkout; throws when git itself fails, which the caller reports as a reason. */
export type GitRunner = (args: readonly string[]) => string;

/** A base ref we are willing to hand to git: no leading dash (an option), no whitespace, no control characters. */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface PullRequestContext {
  /** Repository-relative paths the pull request touches, or null when they cannot be read. */
  changed: ReadonlySet<string> | null;
  /** Why the list is unavailable, in the summary's words; absent when the list was read. */
  unavailable?: string;
}

const gitIn =
  (cwd: string): GitRunner =>
  (args) => {
    try {
      return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
      throw new Error(stderr || (error instanceof Error ? error.message : String(error)));
    }
  };

/**
 * The files this pull request touches, from the checkout alone. `GITHUB_BASE_REF` is set only for
 * pull-request events, so a push or a schedule run gets `changed: null` and the whole report goes to
 * the summary channel — which is the honest outcome: there is no pull request to annotate.
 *
 * The candidate refs cover the two runner layouts: a full checkout has the branch as a local ref, and
 * the usual fetch of the base branch has it as `origin/<base>`. Neither is there in the default
 * shallow checkout, and then the reason says so and names `fetch-depth: 0`.
 */
export function pullRequestContext(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  runGit: GitRunner = gitIn(cwd),
): PullRequestContext {
  const base = (env.GITHUB_BASE_REF ?? "").trim();
  if (base === "") return { changed: null, unavailable: "This run is not a pull request, so there is no base branch to diff against" };
  if (!SAFE_REF.test(base)) return { changed: null, unavailable: `The base branch name "${base}" is not something git can be handed safely` };
  let used: string | undefined;
  for (const candidate of [base, `origin/${base}`]) {
    try {
      runGit(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
      used = candidate;
      break;
    } catch {
      // not in this checkout; try the next spelling
    }
  }
  if (used === undefined) {
    return { changed: null, unavailable: `Neither "${base}" nor "origin/${base}" is in this checkout, so the pull request's files cannot be read; check the repository out with \`fetch-depth: 0\`` };
  }
  let out: string;
  try {
    // Three dots: the changes this head brings since it left the base, not everything that differs
    // between the two tips. `-z` keeps paths with spaces and newlines intact.
    out = runGit(["diff", "--name-only", "-z", "--no-ext-diff", `${used}...HEAD`]);
  } catch (error) {
    return { changed: null, unavailable: `git could not diff this checkout against "${used}": ${error instanceof Error ? error.message : String(error)}` };
  }
  return { changed: new Set(out.split("\0").filter((path) => path !== "")) };
}

/**
 * A line checker over the checkout: the file must be a site-relative path inside the workspace, and the
 * line must be one of its lines. Content is read once per path, so a run with 50 findings in one page
 * costs one read.
 */
export function checkoutLineChecker(workspace: string): (path: string, line: number) => boolean {
  const counts = new Map<string, number>();
  return (path, line) => {
    if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes(":") || path.split("/").includes("..")) return false;
    let count = counts.get(path);
    if (count === undefined) {
      count = lineCount(readFile(join(workspace, ...path.split("/"))));
      counts.set(path, count);
    }
    return count >= line;
  };
}

const readFile = (absolute: string): string | undefined => {
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return undefined; // deleted, unreadable, or never in the checkout: no annotation, and a reason
  }
};

/** Lines of text, the way an editor numbers them: a trailing newline does not add a line, and no content means no lines. */
export function lineCount(text: string | undefined): number {
  if (text === undefined) return -1;
  if (text === "") return 0;
  let lines = 1;
  for (const character of text) if (character === "\n") lines++;
  return text.endsWith("\n") ? lines - 1 : lines;
}
