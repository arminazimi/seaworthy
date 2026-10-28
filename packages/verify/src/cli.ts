#!/usr/bin/env node
// `seaworthy` command: `seaworthy verify [dir]`, `--help`, `--version`.

import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { BaselineError, createBaseline, readBaseline, writeBaseline } from "./baseline.js";
import { ChangedError, changedSinceLastRun, changedSinceRef } from "./changed.js";
import { type ColorEnvironment, detectColorEnvironment, paletteFor, type Palette, PLAIN } from "./color.js";
import { builtInChecks } from "./checks/index.js";
import { ConfigError, loadConfig } from "./config.js";
import { FORMATS, type Format, formatReport } from "./formats/index.js";
import { SEVERITY_ORDER, severityCounts } from "./formats/pretty.js";
import type { Check, Report, Severity } from "./types.js";
import { VERSION } from "./version.js";
import { buildSite } from "./site.js";
import { type StageTiming, type Timings, verifySite } from "./verify.js";

export const EXIT = {
  /** No findings at or above the failing severity. */
  ok: 0,
  /** Findings at or above the failing severity. */
  findings: 1,
  usage: 2,
  /** A check or the engine crashed. */
  internal: 4,
} as const;

/** Folders a build usually writes to, in the order they are tried when no folder is given. */
export const DEFAULT_FOLDERS = ["dist", "build", "out", "public", "_site", "site"] as const;

const HELP = `seaworthy ${VERSION}

Verify any built static site for agents and humans.

Usage:
  seaworthy verify [dir] [options]

Arguments:
  dir                  Built site folder. Default: the first of ${DEFAULT_FOLDERS.join(", ")} that exists.

Options:
  --format <format>    pretty (default), json, markdown, or sarif
  --out <file>         Write the report to a file; print a one-line summary instead
  --fail-on <level>    error (default), warning, note, or none. Exit 1 at or above this severity.
  --config <file>      Config file. Default: seaworthy.config.json in the current folder, if present
  --baseline <file>    Accept the findings recorded in this file; report and fail only on new ones
  --update-baseline <file>
                       Record all current findings in this file, then exit 0
  --changed            Report only findings in files that changed since the last run (hashes in .seaworthy/cache.json)
  --changed-since <ref>
                       Report only findings in files that differ from a git ref (for sites that commit their output)
  --rendered           Run checks that need a browser
  --network            Run checks that make network requests
  --timings            Time each stage and check, printed to stderr; the report is unchanged
  --help, -h           Print this help
  --version, -v        Print the version

Exit codes:
  0  no findings at or above --fail-on
  1  findings at or above --fail-on
  2  usage error
  4  a check or the engine crashed

Status: pre-alpha. See ROADMAP.md.
`;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CliEnvironment {
  /** Base for relative paths. Default: process.cwd(). */
  cwd?: string;
  /** Checks to run. Default: the built-in checks. */
  checks?: readonly Check[];
  /** Terminal and NO_COLOR detection for human output. Default: undefined, which keeps every byte plain. */
  color?: ColorEnvironment;
}

interface Options {
  dir: string | undefined;
  format: Format;
  out: string | undefined;
  failOn: Severity | "none" | undefined;
  config: string | undefined;
  baseline: string | undefined;
  updateBaseline: string | undefined;
  changed: boolean;
  changedSince: string | undefined;
  rendered: boolean;
  network: boolean;
  timings: boolean;
}

class UsageError extends Error {}

function parseOptions(args: readonly string[]): Options {
  const options: Options = { dir: undefined, format: "pretty", out: undefined, failOn: undefined, config: undefined, baseline: undefined, updateBaseline: undefined, changed: false, changedSince: undefined, rendered: false, network: false, timings: false };
  const value = (flag: string, inline: string | undefined, index: number): [string, number] => {
    if (inline !== undefined) return [inline, index];
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return [next, index + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    switch (flag) {
      case "--format": {
        const [v, next] = value(flag, inline, i);
        if (!(FORMATS as readonly string[]).includes(v)) throw new UsageError(`unknown format "${v}"; use ${FORMATS.join(", ")}`);
        options.format = v as Format;
        i = next;
        break;
      }
      case "--out": {
        const [v, next] = value(flag, inline, i);
        options.out = v;
        i = next;
        break;
      }
      case "--fail-on": {
        const [v, next] = value(flag, inline, i);
        if (!["error", "warning", "note", "none"].includes(v)) throw new UsageError(`unknown --fail-on level "${v}"; use error, warning, note, or none`);
        options.failOn = v as Options["failOn"];
        i = next;
        break;
      }
      case "--config":
      case "--baseline":
      case "--update-baseline":
      case "--changed-since": {
        const [v, next] = value(flag, inline, i);
        if (flag === "--config") options.config = v;
        else if (flag === "--baseline") options.baseline = v;
        else if (flag === "--update-baseline") options.updateBaseline = v;
        else options.changedSince = v;
        i = next;
        break;
      }
      case "--changed":
        options.changed = true;
        break;
      case "--rendered":
        options.rendered = true;
        break;
      case "--network":
        options.network = true;
        break;
      case "--timings":
        options.timings = true;
        break;
      default:
        if (arg.startsWith("-")) throw new UsageError(`unknown option ${flag}`);
        if (options.dir !== undefined) throw new UsageError(`unexpected argument "${arg}"; verify takes one folder`);
        options.dir = arg;
    }
  }
  return options;
}

/** The folder as a relative label, so reports never contain absolute paths. */
export function rootLabel(cwd: string, folder: string): string {
  const rel = relative(cwd, folder);
  if (rel === "") return ".";
  if (isAbsolute(rel)) return basename(folder); // a different drive on Windows
  return rel.split("\\").join("/");
}

/** The `--timings` block: total wall time, then each stage, then each check. */
export function formatTimings(totalMs: number, timings: Timings): string {
  const ms = (value: number): string => `${value.toFixed(1)} ms`;
  const lines = ["seaworthy: timings", `  total ${ms(totalMs)}`];
  for (const stage of timings.stages) lines.push(`  stage ${stage.stage} ${ms(stage.ms)}`);
  for (const check of timings.checks) lines.push(`  check ${check.check} ${ms(check.ms)}`);
  return lines.join("\n") + "\n";
}

function failing(report: Report, failOn: Severity | "none"): boolean {
  if (failOn === "none") return false;
  return report.findings.some((f) => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[failOn]);
}

async function verify(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  const options = parseOptions(args);
  const cwd = env.cwd ?? process.cwd();
  const checks = env.checks ?? builtInChecks;

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

  const requested = options.dir ?? config.root ?? DEFAULT_FOLDERS.find((name) => existsSync(resolve(cwd, name)) && statSync(resolve(cwd, name)).isDirectory());
  if (requested === undefined) throw new UsageError(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new UsageError(`${requested} is not a folder`);

  const baselinePath = options.baseline ?? (options.updateBaseline === undefined ? config.baseline : undefined);
  if (baselinePath !== undefined && !existsSync(resolve(cwd, baselinePath))) throw new UsageError(`baseline file not found: ${baselinePath}. Create it with --update-baseline ${baselinePath}.`);

  const label = rootLabel(cwd, folder);
  const siteStarted = tick();
  const site = buildSite(folder, config.basePath === undefined ? {} : { basePath: config.basePath });
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

  const { report, unbaselined, timings: runTimings } = await verifySite({
    folder,
    site,
    ...(changed ? { changed } : {}),
    rootLabel: label,
    checks,
    config,
    ...(configFile ? { configLocation: relative(folder, configFile).split("\\").join("/") } : {}),
    rendered: options.rendered || config.rendered === true,
    network: options.network || config.network === true,
    ...(baselinePath === undefined ? {} : { baseline: readBaseline(resolve(cwd, baselinePath)) }),
    ...(collectTimings ? { timings: true } : {}),
  });
  const timingText = (): string => (collectTimings ? formatTimings(performance.now() - startedAt, { stages: [...stages, ...(runTimings?.stages ?? [])], checks: runTimings?.checks ?? [] }) : "");

  if (options.updateBaseline !== undefined) {
    const baseline = createBaseline(unbaselined);
    writeBaseline(resolve(cwd, options.updateBaseline), baseline);
    return { code: report.errors.length > 0 ? EXIT.internal : EXIT.ok, stdout: `seaworthy: baseline written to ${options.updateBaseline} (${unbaselined.length} finding${unbaselined.length === 1 ? "" : "s"} in ${baseline.entries.length} entr${baseline.entries.length === 1 ? "y" : "ies"})\n`, stderr: crashedNotice(report.errors.length, "; the baseline may be incomplete") + timingText() };
  }

  saveCache?.();
  // Paint the report only when it lands on a terminal as pretty output. Report files and the
  // machine formats (json, markdown, sarif) must stay byte-identical to the plain text everywhere.
  const reportPaint: Palette = options.out === undefined && options.format === "pretty" ? stdoutPaint : PLAIN;
  const text = formatReport(report, options.format, {
    readLine: (file, line) => site.pages.get(`/${file}`)?.source.split(/\r?\n/)[line - 1],
  }, reportPaint);
  let stdout = text;
  if (options.out !== undefined) {
    const target = resolve(cwd, options.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    const findings = report.findings.length === 0 ? stdoutPaint.ok("no findings") : `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} (${severityCounts(report, stdoutPaint)})`;
    stdout = `seaworthy: ${findings}; ${options.format} report written to ${options.out}\n`;
  }
  const failOn = options.failOn ?? config.failOn ?? "error";
  const code = report.errors.length > 0 ? EXIT.internal : failing(report, failOn) ? EXIT.findings : EXIT.ok;
  return { code, stdout, stderr: crashedNotice(report.errors.length, "; see the report") + timingText() };
}

export async function run(argv: readonly string[], env: CliEnvironment = {}): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { code: EXIT.ok, stdout: HELP, stderr: "" };
  if (command === "--version" || command === "-v") return { code: EXIT.ok, stdout: `${VERSION}\n`, stderr: "" };
  try {
    if (command === "verify") return await verify(rest, env);
    return { code: EXIT.usage, stdout: "", stderr: `Unknown command: ${command}\n\n${HELP}` };
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof BaselineError || error instanceof ChangedError) return { code: EXIT.usage, stdout: "", stderr: `seaworthy: ${error.message}\nRun \`seaworthy --help\` for usage.\n` };
    return { code: EXIT.internal, stdout: "", stderr: `seaworthy: ${error instanceof Error ? error.message : String(error)}\n` };
  }
}

// Run only when executed directly (including through the npm bin symlink), not when imported by tests.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const result = await run(process.argv.slice(2), { color: detectColorEnvironment() });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
