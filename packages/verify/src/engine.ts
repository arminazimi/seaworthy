// Runs checks over a site graph and returns findings, skipped checks, and check errors.
// A check that throws never hides the others: its error is recorded and the run continues.

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { Check, CheckError, CheckMeta, Finding, FindingDraft, Needs, Severity, SkippedCheck } from "./types.js";
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
  signal?: AbortSignal;
  /** Passed to checks as `context.changed`. Findings are not filtered here; the pipeline does that. */
  changed?: ReadonlySet<string>;
  /** Collect wall time per check in `RunResult.timings`. Off by default; timings never reach the report. */
  timings?: boolean;
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

function toFinding(meta: CheckMeta, draft: FindingDraft, severity: Severity): Finding {
  return {
    checkId: meta.id,
    severity: draft.severity ?? severity,
    message: draft.message,
    location: draft.location,
    fix: { kind: draft.fix.kind, summary: draft.fix.summary, edits: draft.fix.edits ?? [], appliesTo: "built-output" },
    fingerprint: fingerprint(meta.id, draft.location.file, draft.key),
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

  const signal = options.signal ?? new AbortController().signal;
  const results = await Promise.all(
    runnable.map(async (check) => {
      const startedAt = options.timings ? performance.now() : 0;
      const ms = (): number => (options.timings ? performance.now() - startedAt : 0);
      try {
        const severity = options.severity?.[check.meta.id] ?? check.meta.severity;
        const drafts = await collect(check.run({ site, options: options.options?.[check.meta.id] ?? {}, signal, ...(options.changed ? { changed: options.changed } : {}) }));
        return { check: check.meta.id, findings: drafts.map((draft) => toFinding(check.meta, draft, severity)), ms: ms() };
      } catch (error) {
        return { check: check.meta.id, error: { check: check.meta.id, message: error instanceof Error ? error.message : String(error) }, ms: ms() };
      }
    }),
  );

  const findings: Finding[] = [];
  const errors: CheckError[] = [];
  const timings: CheckTiming[] = [];
  for (const result of results) {
    if ("error" in result) errors.push(result.error);
    else findings.push(...result.findings);
    if (options.timings) timings.push({ check: result.check, ms: result.ms });
  }
  skipped.sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  errors.sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  timings.sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  return { findings, skipped, errors, ...(options.timings ? { timings } : {}) };
}
