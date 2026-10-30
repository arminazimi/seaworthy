// The verification pipeline, shared by the CLI, the MCP server, and the Action.
//
//   build the site graph → run checks → drop ignored files → apply suppressions → apply the baseline → build the report

import { performance } from "node:perf_hooks";

import { resolveBasePath } from "./base-path.js";
import { type Baseline, applyBaseline } from "./baseline.js";
import { type Config, resolveChecks } from "./config.js";
import { type CheckTiming, runChecks } from "./engine.js";
import { matchesGlob } from "./glob.js";
import type { MarkdownSources } from "./markdown.js";
import { findingPrompt } from "./prompt.js";
import { buildReport } from "./report.js";
import { readabilitySummary } from "./readability-score.js";
import { type SiteGraph, buildSite } from "./site.js";
import { type Suppression, SUPPRESSION_CHECKS, applySuppressions, fromConfig, parseInlineSuppressions } from "./suppress.js";
import type { Check, Finding, Report } from "./types.js";

export interface VerifyOptions {
  /** The built site folder. */
  folder: string;
  /** A graph already built for this folder, to avoid building it twice. */
  site?: SiteGraph;
  /** The label for `report.root`: the folder as the user would write it, relative to where verify runs. */
  rootLabel: string;
  checks: readonly Check[];
  /** An explicit `--base` value. It beats the config's `basePath` and detection. */
  baseOverride?: string;
  config?: Config;
  /** Path of the config file relative to the site root, used as the location of config-level problems. */
  configLocation?: string;
  rendered?: boolean;
  network?: boolean;
  /** Cap the report at this many findings, in report order. Default: `DEFAULT_MAX_FINDINGS`. */
  maxFindings?: number;
  /** The browser to launch for checks that render pages, from --browser-path. Default: SEAWORTHY_BROWSER, then an installed Chrome, Chromium, or Edge. */
  browserPath?: string;
  /** When set, findings it accepts are removed from the report and counted. */
  baseline?: Baseline;
  /** Under --changed: site-relative files that changed. Findings elsewhere are not reported. */
  changed?: ReadonlySet<string>;
  /**
   * Under --new-only: the fingerprints the previous run had. A finding in the set was already
   * there — it is dropped from the report like a baselined one, but counted under the existing
   * `summary.findingsOmitted` instead of a counter of its own. The exit code follows the
   * reported findings, so a run that only repeats known problems can pass.
   */
  knownFindings?: ReadonlySet<string>;
  /** From the CLI's --markdown: explicit Markdown sources for the md.* checks, replacing the site-folder walk. Absent: the walk, as ever. */
  markdownSources?: MarkdownSources;
  /** Defaults to the current time. Pass a fixed date in tests. */
  now?: Date;
  /** Collect wall time per stage and per check in `VerifyResult.timings`. Off by default; timings never reach the report. */
  timings?: boolean;
  /**
   * Called with one finding the moment its check finishes, after the ignore, suppression,
   * baseline, `--changed`, and `--new-only` filters have been applied to that check's batch —
   * the same filters the report applies to the whole run, so the streamed set is the report's
   * set.
   * Findings carry their `prompt`, like they do inside the report. Streaming only: without
   * this, the run is exactly as it was before.
   */
  streamFindings?: (finding: Finding) => void;
}

/** Wall time of one pipeline stage, in milliseconds. */
export interface StageTiming {
  stage: string;
  ms: number;
}

export interface Timings {
  /** The stages that ran, in pipeline order. `site` is absent when the caller supplied the graph. */
  stages: StageTiming[];
  /** Wall time of every check that ran, sorted by check ID. */
  checks: CheckTiming[];
}

export interface VerifyResult {
  report: Report;
  site: SiteGraph;
  /** Every finding after suppressions and before the baseline: what `--update-baseline` records. */
  unbaselined: Finding[];
  /** Present only with `timings`. */
  timings?: Timings;
}

export async function verifySite(options: VerifyOptions): Promise<VerifyResult> {
  const config: Config = options.config ?? { checks: {}, ignore: [], suppressions: [] };
  const now = options.now ?? new Date();
  const collectTimings = options.timings === true;
  const stages: StageTiming[] = [];
  const measure = async <T>(stage: string, work: () => T | Promise<T>): Promise<T> => {
    if (!collectTimings) return await work();
    const startedAt = performance.now();
    const value = await work();
    stages.push({ stage, ms: performance.now() - startedAt });
    return value;
  };

  let site: SiteGraph;
  if (options.site !== undefined) site = options.site;
  else
    site = await measure("site", () => {
      // The base path the site is verified against: an explicit `--base`, else the config's
      // `basePath`, else what a known generator config next to the output names, else `/`.
      const { basePath } = resolveBasePath({ folder: options.folder, ...(options.baseOverride !== undefined ? { override: options.baseOverride } : {}), ...(config.basePath !== undefined ? { configBasePath: config.basePath } : {}) });
      return buildSite(options.folder, basePath === "/" ? {} : { basePath });
    });

  const resolved = resolveChecks(config, options.checks);

  // The suppression rules need only the built site, so they are read before the checks run.
  // That is what lets the streamed path filter a finding the moment its check finishes; the
  // timing change stops there - the report, its stages, and their names are all unchanged.
  const inline = parseInlineSuppressions(site, options.checks.map((c) => c.meta.id));
  const configured = fromConfig(config.suppressions, options.configLocation ?? "seaworthy.config.json");
  const rules: readonly Suppression[] = [...inline.suppressions, ...configured];

  // The batch pipeline mirrors the run's stages (ignore → suppress → baseline → --changed → --new-only).
  // Applied per check instead of per run it picks the same findings: suppressions match one
  // finding at a time, and a finding's fingerprint is hashed from its check ID, so every
  // finding with a given baseline fingerprint comes from one check, one batch.
  const streamBatch = options.streamFindings === undefined
    ? undefined
    : (findings: readonly Finding[]): void => {
        const notIgnored = findings.filter((f) => !config.ignore.some((glob) => matchesGlob(glob, f.location.file)));
        const suppression = applySuppressions(notIgnored, rules, now);
        const kept = options.baseline ? applyBaseline(suppression.findings, options.baseline).findings : suppression.findings;
        const scoped = options.changed ? kept.filter((f) => options.changed!.has(f.location.file)) : kept;
        const reported = options.knownFindings ? scoped.filter((f) => !options.knownFindings!.has(f.fingerprint)) : scoped;
        for (const finding of reported) options.streamFindings!({ ...finding, prompt: findingPrompt(finding, options.rootLabel) });
      };

  const run = await measure("checks", () =>
    runChecks({
      site,
      checks: resolved.checks,
      enable: { browser: options.rendered === true, network: options.network === true },
      ...(options.browserPath === undefined ? {} : { browser: { path: options.browserPath } }),
      options: resolved.options,
      severity: resolved.severity,
      ...(options.changed ? { changed: options.changed } : {}),
      ...(options.markdownSources ? { markdownSources: options.markdownSources } : {}),
      ...(collectTimings ? { timings: true } : {}),
      ...(streamBatch === undefined ? {} : { onCheckFindings: (_check: string, findings) => streamBatch(findings) }),
    }),
  );

  const { suppression, unbaselined } = await measure("suppressions", () => {
    const notIgnored = run.findings.filter((f) => !config.ignore.some((glob) => matchesGlob(glob, f.location.file)));
    const suppression = applySuppressions(notIgnored, rules, now);
    return { suppression, unbaselined: [...suppression.findings, ...inline.problems, ...suppression.expired] };
  });

  const { baseline, reported, alreadyKnown } = await measure("baseline", () => {
    const baseline = options.baseline ? applyBaseline(unbaselined, options.baseline) : { findings: unbaselined, baselined: 0, stale: 0 };
    // The baseline is applied to everything first, so entries for unchanged files are not counted as stale.
    const scoped = options.changed ? baseline.findings.filter((f) => options.changed!.has(f.location.file)) : baseline.findings;
    // --new-only last: a finding the baseline or a suppression already hid is not "there" in the
    // report's terms, so it is never counted again here — each filter sees the previous one's output.
    if (options.knownFindings === undefined) return { baseline, reported: scoped, alreadyKnown: 0 };
    const fresh = scoped.filter((f) => !options.knownFindings!.has(f.fingerprint));
    return { baseline, reported: fresh, alreadyKnown: scoped.length - fresh.length };
  });

  const report = await measure("report", () => {
    const skippedIds = new Set(run.skipped.map((x) => x.check));
    const readability = readabilitySummary(site, resolved.checks.map((c) => c.meta.id).filter((id) => !skippedIds.has(id)), baseline.findings);
    return buildReport({
      root: options.rootLabel,
      pages: site.pages.size,
      checks: [...resolved.checks, ...SUPPRESSION_CHECKS],
      findings: reported,
      ...(options.maxFindings === undefined ? {} : { maxFindings: options.maxFindings }),
      ...(Object.keys(resolved.maxFindings).length > 0 ? { checkMaxFindings: resolved.maxFindings } : {}),
      ...(options.changed ? { changedFiles: options.changed.size } : {}),
      ...(alreadyKnown > 0 ? { alreadyKnown } : {}),
      ...(readability ? { readability } : {}),
      suppressed: suppression.suppressed,
      baselined: baseline.baselined,
      baselineStale: baseline.stale,
      skipped: run.skipped,
      errors: run.errors,
    });
  });
  return { report, site, unbaselined, ...(collectTimings ? { timings: { stages, checks: run.timings ?? [] } } : {}) };
}
