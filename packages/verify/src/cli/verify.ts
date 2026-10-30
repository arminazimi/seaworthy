// `seaworthy verify [dir]`: run the checks and report. This module owns the whole command:
// option parsing (through the groups in ./options/), one verification, the `--watch`
// handover, and the `--timings` block.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createBaseline, readBaseline, writeBaseline } from "../baseline.js";
import { resolveBasePath } from "../base-path.js";
import { changedSinceLastRun, changedSinceRef } from "../changed.js";
import { type Palette, paletteFor, PLAIN } from "../color.js";
import { builtInChecks } from "../checks/index.js";
import { loadConfig } from "../config.js";
import { formatReport } from "../formats/index.js";
import { ndjsonLine } from "../formats/ndjson.js";
import { SEVERITY_ORDER, severityCounts } from "../formats/pretty.js";
import { discoverFolder } from "../folders.js";
import { appendHistory, buildHistoryRecord, previousRunKeys, readHistory, runConfigHash } from "../history.js";
import { type MarkdownSources, collectMarkdownFiles, isMarkdownFile } from "../markdown.js";
import { buildSite } from "../site.js";
import type { Check, Report, Severity } from "../types.js";
import { type StageTiming, type Timings, verifySite } from "../verify.js";
import { WatchLoop } from "../watch.js";
import { defaultOptions, OPTION_GROUPS, type Options } from "./options/index.js";
import { DEFAULT_FOLDERS, EXIT, rootLabel, UsageError, type CliEnvironment, type CliResult } from "./types.js";

function parseOptions(args: readonly string[]): Options {
  const options = defaultOptions();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const group = OPTION_GROUPS.find((candidate) => candidate.flags.includes(flag));
    if (group !== undefined) {
      i = group.parse(options, flag, inline, args, i);
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError(`unknown option ${flag}`);
    if (options.dir !== undefined) throw new UsageError(`unexpected argument "${arg}"; verify takes one folder`);
    options.dir = arg;
  }
  return options;
}

/** The `--timings` block: total wall time, then each stage, then each check. */
export function formatTimings(totalMs: number, timings: Timings): string {
  const ms = (value: number): string => `${value.toFixed(1)} ms`;
  const lines = ["seaworthy: timings", `  total ${ms(totalMs)}`];
  for (const stage of timings.stages) lines.push(`  stage ${stage.stage} ${ms(stage.ms)}`);
  for (const check of timings.checks) lines.push(`  check ${check.check} ${ms(check.ms)}`);
  return lines.join("\n") + "\n";
}

/**
 * Resolve the `--markdown` paths against the cwd: files must be Markdown, directories are
 * walked for it. A missing path or a non-Markdown file is a usage error; a directory that
 * holds no Markdown is not — it simply adds no files. Findings stay relative to `cwd`,
 * never absolute, matching how `rootLabel` names the site folder.
 */
function markdownSourcesFor(cwd: string, paths: readonly string[]): MarkdownSources | undefined {
  if (paths.length === 0) return undefined;
  const files: string[] = [];
  for (const path of paths) {
    const absolute = resolve(cwd, path);
    if (!existsSync(absolute)) throw new UsageError(`--markdown: no such file or directory: ${path}`);
    if (statSync(absolute).isDirectory()) files.push(...collectMarkdownFiles(absolute));
    else if (isMarkdownFile(absolute)) files.push(absolute);
    else throw new UsageError(`--markdown: ${path} is neither a Markdown file nor a directory; pass a *.md file or a folder to walk`);
  }
  return { root: cwd, files };
}

function failing(report: Report, failOn: Severity | "none"): boolean {
  if (failOn === "none") return false;
  // Decided from summary.bySeverity, which counts all findings the caps kept and cut, so the
  // exit code never lets a finding hidden by a cap turn the run green.
  return Object.entries(report.summary.bySeverity).some(([severity, count]) => (count ?? 0) > 0 && SEVERITY_ORDER[severity as Severity] <= SEVERITY_ORDER[failOn]);
}

export async function verifyCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  const options = parseOptions(args);
  const cwd = env.cwd ?? process.cwd();
  const checks: readonly Check[] = env.checks ?? builtInChecks;
  const startedIso = new Date().toISOString();

  // Human output may be painted only when its stream is a terminal and NO_COLOR is unset.
  const stdoutPaint = paletteFor(env.color, "stdout");
  const stderrPaint = paletteFor(env.color, "stderr");
  const crashedNotice = (count: number, tail: string): string =>
    count === 0 ? "" : `${stderrPaint.error(`seaworthy: ${count} check${count === 1 ? "" : "s"} crashed`)}${tail}\n`;

  const collectTimings = options.timings;
  const startedAt = collectTimings ? performance.now() : 0;
  const stages: StageTiming[] = [];
  const tick = (): number => (collectTimings ? performance.now() : 0);
  const record = (stage: string, since: number): void => {
    if (collectTimings) stages.push({ stage, ms: performance.now() - since });
  };

  const { config, file: configFile } = loadConfig(cwd, options.config, checks.map((c) => c.meta.id));
  if (options.updateBaseline !== undefined && options.baseline !== undefined) throw new UsageError("use --baseline or --update-baseline, not both");
  if (options.changed && options.changedSince !== undefined) throw new UsageError("use --changed or --changed-since, not both");
  if (options.updateBaseline !== undefined && (options.changed || options.changedSince !== undefined)) throw new UsageError("--update-baseline records every finding, so it cannot be combined with --changed or --changed-since");
  if (options.watch && options.updateBaseline !== undefined) throw new UsageError("--update-baseline writes the baseline and exits, so it cannot be combined with --watch");
  if (options.watch && (options.changed || options.changedSince !== undefined)) throw new UsageError("use --watch or --changed, not both; --watch already reports only what changed");
  if (options.newOnly && !options.history) throw new UsageError("--new-only compares with .seaworthy/history, which --no-history opts out of; use --new-only or --no-history, not both");

  const requested = options.dir ?? config.root ?? discoverFolder(cwd);
  if (requested === undefined) throw new UsageError(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder)) throw new UsageError(`no folder ${requested}; pass the folder your build writes to, or build first`);
  if (!statSync(folder).isDirectory()) throw new UsageError(`${requested} is not a folder; pass the folder your build writes to`);

  const baselinePath = options.baseline ?? (options.updateBaseline === undefined ? config.baseline : undefined);
  if (baselinePath !== undefined && !existsSync(resolve(cwd, baselinePath))) throw new UsageError(`baseline file not found: ${baselinePath}. Create it with --update-baseline ${baselinePath}.`);

  const label = rootLabel(cwd, folder);
  const markdownSources = markdownSourcesFor(cwd, options.markdown);

  /** One verification of whatever the build folder holds right now; a re-run rebuilds and re-reads. */
  const runOnce = async (): Promise<{ report: Report; code: number; stdout: string; stderr: string }> => {
    const siteStarted = tick();
    // Precedence: `--base`, then the config's `basePath`, then a known generator config next to the
    // output, then `/`. When detection examined a config but could not read a base path, say why.
    const base = resolveBasePath({ folder, ...(options.base !== undefined ? { override: options.base } : {}), ...(config.basePath !== undefined ? { configBasePath: config.basePath } : {}) });
    const site = buildSite(folder, base.basePath === "/" ? {} : { basePath: base.basePath });
    record("site", siteStarted);
    let saveCache: (() => void) | undefined;
    let changed: Set<string> | undefined;
    if (options.changedSince !== undefined || options.changed) {
      const changedStarted = tick();
      if (options.changedSince !== undefined) changed = changedSinceRef(folder, options.changedSince).files;
      else {
        const result = changedSinceLastRun(site, cwd, label);
        changed = result.changed.files;
        saveCache = result.save;
      }
      record("changed", changedStarted);
    }

    // --new-only: what the previous run had is what the newest history record stored. No store,
    // a record written before keys existed, or a newest record for another folder all mean
    // "unknown": report everything, and say so where a human reads the report. Read inside the
    // run, before this run's own record is appended below.
    let knownFindings: ReadonlySet<string> | undefined;
    if (options.newOnly) knownFindings = previousRunKeys(readHistory(cwd), label);

    // NDJSON goes out one finding per line, as its check finishes. The lines are always
    // collected here, so --out and the summary use the same bytes; with a `stream` sink and
    // no file target they are also written while the run is still going. --update-baseline
    // prints its summary, so it does not stream. Other formats render the finished report.
    const streamedFormat = options.format === "ndjson";
    let ndjson = "";
    const { report, unbaselined, timings: runTimings } = await verifySite({
      folder,
      site,
      ...(changed ? { changed } : {}),
      ...(knownFindings === undefined ? {} : { knownFindings }),
      rootLabel: label,
      checks,
      config,
      ...(configFile ? { configLocation: relative(folder, configFile).split("\\").join("/") } : {}),
      rendered: options.rendered || config.rendered === true,
      ...(options.browserPath === undefined ? {} : { browserPath: options.browserPath }),
      network: options.network || config.network === true,
      ...(markdownSources === undefined ? {} : { markdownSources }),
      ...(options.maxFindings === undefined ? {} : { maxFindings: options.maxFindings }),
      ...(baselinePath === undefined ? {} : { baseline: readBaseline(resolve(cwd, baselinePath)) }),
      ...(collectTimings ? { timings: true } : {}),
      ...(streamedFormat
        ? {
            streamFindings: (finding) => {
              ndjson += ndjsonLine(finding);
              if (options.out === undefined && options.updateBaseline === undefined) env.stream?.(ndjsonLine(finding));
            },
          }
        : {}),
    });
    const timingText = (): string => (collectTimings ? formatTimings(performance.now() - startedAt, { stages: [...stages, ...(runTimings?.stages ?? [])], checks: runTimings?.checks ?? [] }) : "");

    if (options.updateBaseline !== undefined) {
      const baseline = createBaseline(unbaselined);
      writeBaseline(resolve(cwd, options.updateBaseline), baseline);
      return { report, code: report.errors.length > 0 ? EXIT.internal : EXIT.ok, stdout: `seaworthy: baseline written to ${options.updateBaseline} (${unbaselined.length} finding${unbaselined.length === 1 ? "" : "s"} in ${baseline.entries.length} entr${baseline.entries.length === 1 ? "y" : "ies"})\n`, stderr: crashedNotice(report.errors.length, "; the baseline may be incomplete") + timingText() };
    }

    saveCache?.();
    // Paint the report only when it lands on a terminal as pretty output. Report files and the
    // machine formats (json, markdown, sarif, llm, ndjson) must stay byte-identical to the plain text everywhere.
    const reportPaint: Palette = options.out === undefined && options.format === "pretty" ? stdoutPaint : PLAIN;
    let stdout: string;
    if (options.format === "ndjson") {
      stdout = ndjson;
    } else {
      // The html report draws its trend from the runs already on disk; the store is read where the
      // CLI runs, like `seaworthy history`. Only html asks for it, so the machine formats read nothing.
      const history = options.format === "html" ? readHistory(cwd) : undefined;
      stdout = formatReport(report, options.format, {
        readLine: (file, line) => site.pages.get(`/${file}`)?.source.split(/\r?\n/)[line - 1],
        ...(history === undefined ? {} : { history }),
      }, reportPaint);
    }
    if (options.out !== undefined) {
      const text = options.format === "ndjson" ? ndjson : stdout;
      const target = resolve(cwd, options.out);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      const findings = report.findings.length === 0 ? stdoutPaint.ok("no findings") : `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} (${severityCounts(report, stdoutPaint)})`;
      stdout = `seaworthy: ${findings}; ${options.format} report written to ${options.out}\n`;
    }
    // Human-readable output only: machine formats must stay byte-identical with and without
    // --new-only, so the notice rides on the pretty stdout (and on the --out one-liner).
    if (options.newOnly && knownFindings === undefined && options.format === "pretty") {
      stdout += "seaworthy: --new-only found no previous run with stored findings in .seaworthy/history, so every finding is reported.\n";
    }
    const failOn = options.failOn ?? config.failOn ?? "error";

    // Run history is on by default: one record in .seaworthy/history per verify run, for diffs
    // and trends between runs. It writes only that folder, never the report, never stdout or
    // stderr on success, so machine-readable output is byte-identical with and without history.
    // A --update-baseline run is a setup step, not a comparable run, and returns above.
    const runsHistory = options.history && config.history !== false;
    const historyStderr = (): string => {
      if (!runsHistory) return "";
      const settings = {
        root: label,
        basePath: config.basePath ?? null,
        failOn,
        rendered: options.rendered || config.rendered === true,
        network: options.network || config.network === true,
        baseline: baselinePath ?? null,
        checks: config.checks,
        ignore: config.ignore,
        suppressions: config.suppressions,
      };
      try {
        appendHistory(cwd, buildHistoryRecord(report, { started: startedIso, configHash: runConfigHash(settings), findings: unbaselined }));
        return "";
      } catch (error) {
        return `seaworthy: could not record run history: ${error instanceof Error ? error.message : String(error)}\n`;
      }
    };

    const runFails = report.errors.length > 0 ? EXIT.internal : failing(report, failOn) ? EXIT.findings : EXIT.ok;
    return { report, code: runFails, stdout, stderr: crashedNotice(report.errors.length, "; see the report") + historyStderr() + timingText() };
  };

  const first = await runOnce();
  if (!options.watch) return { code: first.code, stdout: first.stdout, stderr: first.stderr };

  // --watch: the first run is reported exactly like the non-watch path above; from then on, every
  // change to the build folder produces one re-verified compact diff against the previous report.
  const write = env.watch?.write ?? ((text: string): void => { process.stdout.write(text); });
  const writeError = env.watch?.writeError ?? ((text: string): void => { process.stderr.write(text); });
  const loop = new WatchLoop({
    folder,
    previous: first.report,
    run: async () => (await runOnce()).report,
    notify: write,
    error: writeError,
    ...(env.watch?.debounceMs === undefined ? {} : { debounceMs: env.watch.debounceMs }),
  });
  loop.start();
  env.watch?.onLoop?.(loop);
  return { code: first.code, stdout: first.stdout, stderr: first.stderr };
}
