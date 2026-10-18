// The verification pipeline, shared by the CLI, the MCP server, and the Action.
//
//   build the site graph → run checks → drop ignored files → apply suppressions → apply the baseline → build the report

import { type Baseline, applyBaseline } from "./baseline.js";
import { type Config, resolveChecks } from "./config.js";
import { runChecks } from "./engine.js";
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
  config?: Config;
  /** Path of the config file relative to the site root, used as the location of config-level problems. */
  configLocation?: string;
  rendered?: boolean;
  network?: boolean;
  /** When set, findings it accepts are removed from the report and counted. */
  baseline?: Baseline;
  /** Under --changed: site-relative files that changed. Findings elsewhere are not reported. */
  changed?: ReadonlySet<string>;
  /** Defaults to the current time. Pass a fixed date in tests. */
  now?: Date;
}

export interface VerifyResult {
  report: Report;
  site: SiteGraph;
  /** Every finding after suppressions and before the baseline: what `--update-baseline` records. */
  unbaselined: Finding[];
}

export async function verifySite(options: VerifyOptions): Promise<VerifyResult> {
  const config: Config = options.config ?? { checks: {}, ignore: [], suppressions: [] };
  const now = options.now ?? new Date();
  const site = options.site ?? buildSite(options.folder, config.basePath === undefined ? {} : { basePath: config.basePath });

  const resolved = resolveChecks(config, options.checks);
  const run = await runChecks({
    site,
    checks: resolved.checks,
    enable: { browser: options.rendered === true, network: options.network === true },
    options: resolved.options,
    severity: resolved.severity,
    ...(options.changed ? { changed: options.changed } : {}),
  });

  const knownIds = options.checks.map((c) => c.meta.id);
  const inline = parseInlineSuppressions(site, knownIds);
  const configured = fromConfig(config.suppressions, options.configLocation ?? "seaworthy.config.json");

  const notIgnored = run.findings.filter((f) => !config.ignore.some((glob) => matchesGlob(glob, f.location.file)));
  const suppression = applySuppressions(notIgnored, [...inline.suppressions, ...configured], now);
  const unbaselined = [...suppression.findings, ...inline.problems, ...suppression.expired];

  const baseline = options.baseline ? applyBaseline(unbaselined, options.baseline) : { findings: unbaselined, baselined: 0, stale: 0 };
  // The baseline is applied to everything first, so entries for unchanged files are not counted as stale.
  const reported = options.changed ? baseline.findings.filter((f) => options.changed!.has(f.location.file)) : baseline.findings;
  const skippedIds = new Set(run.skipped.map((x) => x.check));
  const readability = readabilitySummary(site, resolved.checks.map((c) => c.meta.id).filter((id) => !skippedIds.has(id)), baseline.findings);
  const report = buildReport({
    root: options.rootLabel,
    pages: site.pages.size,
    checks: [...resolved.checks, ...SUPPRESSION_CHECKS],
    findings: reported,
    ...(options.changed ? { changedFiles: options.changed.size } : {}),
    ...(readability ? { readability } : {}),
    suppressed: suppression.suppressed,
    baselined: baseline.baselined,
    baselineStale: baseline.stale,
    skipped: run.skipped,
    errors: run.errors,
  });
  return { report, site, unbaselined };
}
