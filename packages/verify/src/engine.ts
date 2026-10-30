// Runs checks over a site graph and returns findings, skipped checks, and check errors.
// A check that throws never hides the others: its error is recorded and the run continues.
//
// Static built-in checks run in a `node:worker_threads` pool once the site is big enough to
// pay for it (issue #218): each worker rebuilds the same deterministic graph and runs one
// check at a time. The ASSEMBLY below is what keeps the report deterministic — outcomes are
// stored at the check's own position, so findings, skipped, and errors come out in exactly
// the order a sequential run produces, whatever order the workers finish in.

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { PARALLEL_MIN_PAGES, runCheckPool, workerBudget, workerSafe, type WorkerJob, type WorkerOutcome } from "./check-pool.js";
import type { Check, CheckContext, CheckError, CheckMeta, EvidenceSink, Finding, FindingDraft, Needs, ProbeSkip, Severity, SkippedCheck } from "./types.js";
import type { MarkdownSources } from "./markdown.js";
import type { SiteGraph } from "./site.js";

export interface RunOptions {
  site: SiteGraph;
  checks: readonly Check[];
  /** Opt-in capabilities. A check that needs one that is off is skipped, never silently passed. */
  enable?: Partial<Record<Extract<Needs, "browser" | "network">, boolean>>;
  /** Per-check options, keyed by check ID. */
  options?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Overrides each check's default severity, keyed by check ID. */
  severity?: Readonly<Record<string, Severity>>;
  /** The browser to launch, for checks that render pages. Default: SEAWORTHY_BROWSER, then an installed Chrome, Chromium, or Edge. */
  browser?: { path?: string };
  /** Set under --evidence: the folder rendered checks save their proof crops into. */
  evidence?: EvidenceSink;
  signal?: AbortSignal;
  /** Passed to checks as `context.changed`. Findings are not filtered here; the pipeline does that. */
  changed?: ReadonlySet<string>;
  /** Passed to checks as `context.markdownSources`: the `--markdown` list, when given. */
  markdownSources?: MarkdownSources;
  /** Collect wall time per check in `RunResult.timings`. Off by default; timings never reach the report. */
  timings?: boolean;
  /**
   * Called with one check's findings the moment that check finishes, in completion order.
   * Reporting only: the returned arrays are unchanged, so consumers that do not pass this
   * see the exact same run.
   */
  onCheckFindings?: (checkId: string, findings: readonly Finding[]) => void;
}

/** Wall time of one check, in milliseconds. Checks run in parallel, so these overlap. */
export interface CheckTiming {
  check: string;
  ms: number;
}

export interface RunResult {
  findings: Finding[];
  skipped: SkippedCheck[];
  errors: CheckError[];
  /** Present only with `timings`: one entry per check that ran, sorted by check ID. */
  timings?: CheckTiming[];
}

const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/**
 * Identifies a finding without its line number, so edits above it do not change it.
 * `key` is a stable identity such as an href, an image src, or a CSS selector.
 */
export function fingerprint(checkId: string, file: string, key: string): string {
  return createHash("sha256").update([checkId, file, key].join("\u0000")).digest("hex").slice(0, 16);
}

export function validateCheckId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid check ID "${id}": use lowercase "area.rule", for example "links.internal"`);
}

const SKIP_HINTS: Record<"browser" | "network", { reason: string; hint: string }> = {
  browser: {
    reason: "rendered-checks-disabled",
    hint: "Run with --rendered to enable checks that need a browser. Chrome, Chromium, or Edge must be installed.",
  },
  network: {
    reason: "network-checks-disabled",
    hint: "Run with --network to enable checks that make network requests.",
  },
};

async function collect(drafts: AsyncIterable<FindingDraft> | Iterable<FindingDraft>): Promise<FindingDraft[]> {
  const out: FindingDraft[] = [];
  for await (const draft of drafts) out.push(draft);
  return out;
}

function contextFor(check: Check, options: RunOptions): CheckContext {
  return {
    site: options.site,
    options: options.options?.[check.meta.id] ?? {},
    signal: options.signal ?? new AbortController().signal,
    ...(options.changed ? { changed: options.changed } : {}),
    ...(options.browser ? { browser: options.browser } : {}),
    ...(options.markdownSources ? { markdownSources: options.markdownSources } : {}),
    ...(options.evidence ? { evidence: options.evidence } : {}),
  };
}

function toFinding(meta: CheckMeta, draft: FindingDraft, severity: Severity): Finding {
  return {
    checkId: meta.id,
    severity: draft.severity ?? severity,
    message: draft.message,
    location: draft.location,
    fix: { kind: draft.fix.kind, summary: draft.fix.summary, edits: draft.fix.edits ?? [], appliesTo: "built-output" },
    fingerprint: fingerprint(meta.id, draft.location.file, draft.key),
    ...(draft.evidence === undefined ? {} : { evidence: draft.evidence }),
  };
}

/** One runnable check's result, in the shape the assembly step reads. */
type CheckOutcome =
  | { check: string; findings: Finding[]; ms: number }
  | { check: string; skipped: ProbeSkip; ms: number }
  | { check: string; error: CheckError; ms: number };

/** Run one check on the main thread, exactly as the engine always did. */
async function runOne(check: Check, options: RunOptions, collectTimings: boolean): Promise<CheckOutcome> {
  const startedAt = collectTimings ? performance.now() : 0;
  const ms = (): number => (collectTimings ? performance.now() - startedAt : 0);
  const ctx = contextFor(check, options);
  try {
    // A check that cannot run where it was enabled (no browser, say) skips itself before it runs.
    if (check.probe) {
      const probe = await check.probe(ctx);
      if (probe) return { check: check.meta.id, skipped: probe, ms: ms() };
    }
    const drafts = await collect(check.run(ctx));
    const findings = drafts.map((draft) => toFinding(check.meta, draft, severityFor(check, options)));
    options.onCheckFindings?.(check.meta.id, findings);
    return { check: check.meta.id, findings, ms: ms() };
  } catch (error) {
    return { check: check.meta.id, error: { check: check.meta.id, message: error instanceof Error ? error.message : String(error) }, ms: ms() };
  }
}

function severityFor(check: Check, options: RunOptions): Severity {
  return options.severity?.[check.meta.id] ?? check.meta.severity;
}

/** The job payload for one pooled check: only what a worker can rebuild or clone. */
function jobFor(check: Check, options: RunOptions): WorkerJob {
  const { changed, markdownSources } = options;
  return {
    checkId: check.meta.id,
    root: options.site.root,
    basePath: options.site.basePath,
    options: options.options?.[check.meta.id] ?? {},
    ...(changed === undefined ? {} : { changed: [...changed].sort() }),
    ...(markdownSources === undefined ? {} : { markdownSources }),
  };
}

export async function runChecks(options: RunOptions): Promise<RunResult> {
  const { site, checks } = options;
  const seen = new Set<string>();
  for (const check of checks) {
    validateCheckId(check.meta.id);
    if (seen.has(check.meta.id)) throw new Error(`duplicate check ID ${check.meta.id}`);
    seen.add(check.meta.id);
  }

  const skipped: SkippedCheck[] = [];
  const runnable: Check[] = [];
  for (const check of checks) {
    const blocked = (["browser", "network"] as const).find((need) => check.meta.needs.includes(need) && !options.enable?.[need]);
    if (blocked) skipped.push({ check: check.meta.id, ...SKIP_HINTS[blocked] });
    else runnable.push(check);
  }

  const collectTimings = options.timings === true;
  const results: CheckOutcome[] = [];

  // Which runnable checks a worker may carry. The registry import is lazy: a small site
  // never pays for the check modules here (they are already loaded by every caller that
  // passes them in — see the identity rule below), and the CLI startup budget stays put.
  // `SEAWORTHY_WORKERS` forces the decision either way; see check-pool.ts.
  let pooled: Check[] = [];
  if (runnable.length >= 2 && (site.pages.size >= PARALLEL_MIN_PAGES || workerBudget(0, runnable.length) > 0)) {
    const { builtInChecks } = await import("./checks/registry.js");
    pooled = runnable.filter((check) => workerSafe(check, builtInChecks));
  }
  const workers = workerBudget(site.pages.size, pooled.length);
  if (workers >= 2 && pooled.length >= 2) {
    // The pooled checks' positions in `runnable`, so outcomes land exactly where a
    // sequential run would have put them.
    const slot = new Map<string, number>();
    runnable.forEach((check, index) => {
      if (pooled.includes(check)) slot.set(check.meta.id, index);
    });
    const outcomes = new Array<CheckOutcome | undefined>(runnable.length);
    const jobs: WorkerJob[] = pooled.map((check) => jobFor(check, options));
    const byId = new Map(pooled.map((check) => [check.meta.id, check]));
    // Checks a worker could not carry: they rerun on the main thread and are awaited below.
    const fallbacks: Promise<void>[] = [];

    const place = (outcome: WorkerOutcome): void => {
      const index = slot.get(outcome.checkId);
      if (index === undefined || outcomes[index] !== undefined) return;
      const check = byId.get(outcome.checkId)!;
      if (outcome.kind === "findings") {
        const findings = outcome.drafts.map((draft) => toFinding(check.meta, draft, severityFor(check, options)));
        outcomes[index] = { check: check.meta.id, findings, ms: outcome.ms };
        // Worker checks observe no abort signal: every static built-in check ignores it (the
        // rendered ones that do cannot be pooled), and the pool reruns on the main thread
        // anything it cannot carry, so behavior is unchanged.
        options.onCheckFindings?.(check.meta.id, findings);
      } else if (outcome.kind === "error") {
        outcomes[index] = { check: check.meta.id, error: { check: check.meta.id, message: outcome.message }, ms: outcome.ms };
      } else {
        fallbacks.push(runOne(check, options, collectTimings).then((result) => {
          outcomes[index] = result;
        }));
      }
    };

    await Promise.all([
      runCheckPool(jobs, workers, place),
      ...runnable.map((check, index) => (slot.has(check.meta.id) ? Promise.resolve() : runOne(check, options, collectTimings).then((result) => { outcomes[index] = result; }))),
    ]);
    await Promise.all(fallbacks);
    for (let index = 0; index < runnable.length; index += 1) {
      const outcome = outcomes[index];
      if (outcome === undefined) throw new Error(`engine: check ${runnable[index]!.meta.id} never reported`);
      results.push(outcome);
    }
  } else {
    results.push(...(await Promise.all(runnable.map((check) => runOne(check, options, collectTimings)))));
  }

  const findings: Finding[] = [];
  const errors: CheckError[] = [];
  const timings: CheckTiming[] = [];
  for (const result of results) {
    if ("skipped" in result) skipped.push({ check: result.check, ...result.skipped });
    else if ("error" in result) errors.push(result.error);
    else findings.push(...result.findings);
    if (collectTimings && !("skipped" in result)) timings.push({ check: result.check, ms: result.ms });
  }
  skipped.sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  errors.sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  timings.sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  return { findings, skipped, errors, ...(collectTimings ? { timings } : {}) };
}
