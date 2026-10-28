// The verification pipeline, shared by the CLI, the MCP server, and the Action.
//
//   build the site graph → run checks → drop ignored files → apply suppressions → apply the baseline → build the report

import { performance } from "node:perf_hooks";

import { resolveBasePath } from "./base-path.js";
import { type Baseline, applyBaseline } from "./baseline.js";
import { type Config, resolveChecks } from "./config.js";
import { type CheckTiming, runChecks } from "./engine.js";
import { matchesGlob } from "./glob.js";
import { buildReport } from "./report.js";
import { readabilitySummary } from "./readability-score.js";
import { type SiteGraph, buildSite } from "./site.js";
import { SUPPRESSION_CHECKS, applySuppressions, fromConfig, parseInlineSuppressions } from "./suppress.js";
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
  /** When set, findings it accepts are removed from the report and counted. */
  baseline?: Baseline;
  /** Under --changed: site-relative files that changed. Findings elsewhere are not reported. */
  changed?: ReadonlySet<string>;
  /** Defaults to the current time. Pass a fixed date in tests. */
  now?: Date;
  /** Collect wall time per stage and per check in `VerifyResult.timings`. Off by default; timings never reach the report. */
  timings?: boolean;
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
  const run = await measure("checks", () =>
    runChecks({
      site,
      checks: resolved.checks,
      enable: { browser: options.rendered === true, network: options.network === true },
      options: resolved.options,
      severity: resolved.severity,
      ...(options.changed ? { changed: options.changed } : {}),
      ...(collectTimings ? { timings: true } : {}),
    }),
  );

  const { suppression, unbaselined } = await measure("suppressions", () => {
    const knownIds = options.checks.map((c) => c.meta.id);
    const inline = parseInlineSuppressions(site, knownIds);
    const configured = fromConfig(config.suppressions, options.configLocation ?? "seaworthy.config.json");
    const notIgnored = run.findings.filter((f) => !config.ignore.some((glob) => matchesGlob(glob, f.location.file)));
    const suppression = applySuppressions(notIgnored, [...inline.suppressions, ...configured], now);
    return { suppression, unbaselined: [...suppression.findings, ...inline.problems, ...suppression.expired] };
  });

  const { baseline, reported } = await measure("baseline", () => {
    const baseline = options.baseline ? applyBaseline(unbaselined, options.baseline) : { findings: unbaselined, baselined: 0, stale: 0 };
    // The baseline is applied to everything first, so entries for unchanged files are not counted as stale.
    const reported = options.changed ? baseline.findings.filter((f) => options.changed!.has(f.location.file)) : baseline.findings;
    return { baseline, reported };
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
