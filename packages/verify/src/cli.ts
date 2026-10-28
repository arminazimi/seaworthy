#!/usr/bin/env node
// `seaworthy` commands: `seaworthy verify [dir]`, `seaworthy config check`, `--help`, `--version`.

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { BaselineError, createBaseline, readBaseline, writeBaseline } from "./baseline.js";
import { resolveBasePath } from "./base-path.js";
import { ChangedError, changedSinceLastRun, changedSinceRef } from "./changed.js";
import { type ColorEnvironment, detectColorEnvironment, paletteFor, type Palette, PLAIN } from "./color.js";
import { builtInChecks } from "./checks/index.js";
import { CONFIG_FILE, ConfigError, loadConfig } from "./config.js";
import { ReportDiffError, diffReports, diffToJson, readReport } from "./diff.js";
import { FORMATS, type Format, formatReport } from "./formats/index.js";
import { appendHistory, buildHistoryRecord, runConfigHash } from "./history.js";
import { SEVERITY_ORDER, severityCounts } from "./formats/pretty.js";
import { type FixPreview, planFix } from "./fix.js";
import { BASELINE_FILE, detectGenerator, INIT_MARKERS, INIT_MARKERS_HINT, planInit, WORKFLOW_FILE, type PlanOptions } from "./init.js";
import type { Check, Report, Severity } from "./types.js";
import { DEFAULT_MAX_FINDINGS } from "./report.js";
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
  seaworthy init [dir] [options]
  seaworthy fix [dir] [options]
  seaworthy diff <before.json> <after.json>
  seaworthy config check [file]

Arguments:
  dir                  verify: built site folder, default the first of ${DEFAULT_FOLDERS.join(", ")} that exists.
                       init: the project folder (the source), default the current folder.

Commands:
  config check [file]  Validate a config file without running checks. See \`seaworthy config check --help\`.
  init [dir]           Write a config, a CI workflow, and an empty baseline in one step. See \`seaworthy init --help\`.
  fix --dry-run        Preview every suggested edit as one unified diff. See \`seaworthy fix --help\`.

Options:
  --format <format>    pretty (default), json, markdown, sarif, llm, prompt, or html.
                       prompt: one copy-pasteable prompt that fixes every finding,
                       grouped by file (fewest findings first), to work through in order.
                       html: one self-contained page for people, with severity, check, and file filters
  --out <file>         Write the report to a file; print a one-line summary instead
  --fail-on <level>    error (default), warning, note, or none. Exit 1 at or above this severity.
  --base <path>        The path the site is deployed under, such as /repo/. Overrides basePath
                        in seaworthy.config.json and base-path detection from generator configs.
  --max-findings <n>   Cap the report at n findings, in report order; the rest are omitted and counted
                       in the report as findingsOmitted. Default: ${DEFAULT_MAX_FINDINGS}. Caps never
                       change the exit code; it is decided from all findings, cut or not
  --config <file>      Config file. Default: seaworthy.config.json in the current folder, if present
  --baseline <file>    Accept the findings recorded in this file; report and fail only on new ones
  --update-baseline <file>
                       Record all current findings in this file, then exit 0
  --changed            Report only findings in files that changed since the last run (hashes in .seaworthy/cache.json)
  --changed-since <ref>
                       Report only findings in files that differ from a git ref (for sites that commit their output)
  --no-history         Do not record this run in .seaworthy/history (default on; also "history": false in the config)
  --rendered           Run checks that need a browser
  --network            Run checks that make network requests
  --timings            Time each stage and check, printed to stderr; the report is unchanged
  --help, -h           Print this help
  --version, -v        Print the version

diff:
  seaworthy diff before.json after.json
                       Compare two report JSON files from \`verify --format json\` runs. Prints
                       one JSON object with the counts and finding lists for what is new, fixed,
                       and unchanged. Findings match by fingerprint, so the same problem is
                       unchanged even when it moves to another line.

init:
  seaworthy init [dir]
                       Run in dir (default: the current folder), where it detects the site generator from
                       marker file names only (Jekyll, Astro, Docusaurus, Hugo, or GitHub Pages) and writes:
                         seaworthy.config.json            root and baseline, per the published config schema
                         .github/workflows/seaworthy.yml  a build step for the generator, then seaworthy verify
                         seaworthy-baseline.json          an EMPTY first baseline, so CI fails on new findings only
                       Non-interactive, offline, and never a write outside dir. A second run says "already
                       present"; --force overwrites the config and the workflow it owns, but a baseline is
                       never rewritten, because a baseline records findings you have accepted.

Exit codes:
  0  no findings at or above --fail-on (verify); the diff completed (diff); all files present (init); the fix preview completed (fix)
  1  findings at or above --fail-on
  2  usage error
  4  a check or the engine crashed

fix (always passes --dry-run):
  seaworthy fix [dir] --dry-run
                       Run the checks, then print ONE unified diff of every edit the suggested
                       fixes would apply to the built output, with paths relative to the site
                       folder. Seaworthy never writes or edits files: applying the diff with
                       \`git apply\` (run from the site folder) is an agent's or a person's move.
                       Findings whose fixes cannot be turned into safe edits — manual fixes,
                       edits that need content a person must supply (such as alt text), or
                       edits whose anchor text no longer matches the file — are listed on
                       stderr as manual guidance instead. See \`seaworthy fix --help\`.

Status: pre-alpha. See ROADMAP.md.
`;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const CONFIG_HELP = `seaworthy config check

Validate a config file with the same rules \`verify\` applies, without running any checks or reading the site.

Usage:
  seaworthy config check [file]

Arguments:
  file                 Config file. Default: ${CONFIG_FILE} in the current folder, if present

Options:
  --config <file>      The config file, as a flag instead of a positional argument
  --help, -h           Print this help

Exit codes:
  0  the config is valid; with no config file, checks would run with their defaults
  2  the file is missing, is not valid JSON, or has problems (every problem is listed)
`;

const INIT_HELP = `seaworthy init

Create the three files that adopt Seaworthy in one step, for people and agents. It detects the
site generator from marker file names only (Jekyll, Astro, Docusaurus, Hugo, or GitHub Pages)
and writes, without ever reading or editing your own files, without running any checks, and with
no writes outside the folder you name:

  seaworthy.config.json             built site folder and the baseline, per the config schema
  .github/workflows/seaworthy.yml   the generator's build step, then \`seaworthy verify\`
  seaworthy-baseline.json           an EMPTY first baseline: today's findings are accepted by
                                    recording them with --update-baseline (docs/configuration.md),
                                    while CI fails on every new one

The workflow is commented, and the config is plain JSON (JSON has no comments and the schema
rejects unknown keys), so the guidance a commented config would carry lives in the workflow and
in the docs page.

Usage:
  seaworthy init [dir]

Arguments:
  dir                  The project folder (the source, not the built site). Default: the current folder.

Options:
  --force              Overwrite seaworthy.config.json and seaworthy.yml with init's version. A second run
                       without it says "already present" and changes nothing. A baseline file that already
                       exists is never rewritten -- not even with --force -- because it records findings
                       you have accepted.
  --help, -h           Print this help

Exit codes:
  0  every file is present now (written, or kept and reported)
  2  usage error
`;


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
  base: string | undefined;
  maxFindings: number | undefined;
  config: string | undefined;
  baseline: string | undefined;
  updateBaseline: string | undefined;
  changed: boolean;
  changedSince: string | undefined;
  rendered: boolean;
  network: boolean;
  /** Record the run in .seaworthy/history. Default on; `--no-history` is the per-run opt-out. */
  history: boolean;
  timings: boolean;
}

class UsageError extends Error {}

function parseOptions(args: readonly string[]): Options {
  const options: Options = { dir: undefined, format: "pretty", out: undefined, failOn: undefined, base: undefined, maxFindings: undefined, config: undefined, baseline: undefined, updateBaseline: undefined, changed: false, changedSince: undefined, rendered: false, network: false, history: true, timings: false };
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
      case "--max-findings": {
        const [v, next] = value(flag, inline, i);
        const n = /^\d+$/.test(v) ? Number(v) : NaN;
        if (!Number.isInteger(n) || n < 1) throw new UsageError(`--max-findings must be a whole number of at least 1, got "${v}"`);
        options.maxFindings = n;
        i = next;
        break;
      }
      case "--config":
      case "--baseline":
      case "--update-baseline":
      case "--base":
      case "--changed-since": {
        const [v, next] = value(flag, inline, i);
        if (flag === "--config") options.config = v;
        else if (flag === "--baseline") options.baseline = v;
        else if (flag === "--update-baseline") options.updateBaseline = v;
        else if (flag === "--base") options.base = v;
        else options.changedSince = v;
        i = next;
        break;
      }
      case "--changed":
        options.changed = true;
        break;
      case "--no-history":
        options.history = false;
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
  // Decided from summary.bySeverity, which counts all findings the caps kept and cut, so the
  // exit code never lets a finding hidden by a cap turn the run green.
  return Object.entries(report.summary.bySeverity).some(([severity, count]) => (count ?? 0) > 0 && SEVERITY_ORDER[severity as Severity] <= SEVERITY_ORDER[failOn]);
}

async function verify(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  const options = parseOptions(args);
  const cwd = env.cwd ?? process.cwd();
  const checks = env.checks ?? builtInChecks;
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

  const requested = options.dir ?? config.root ?? DEFAULT_FOLDERS.find((name) => existsSync(resolve(cwd, name)) && statSync(resolve(cwd, name)).isDirectory());
  if (requested === undefined) throw new UsageError(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder)) throw new UsageError(`no folder ${requested}; pass the folder your build writes to, or build first`);
  if (!statSync(folder).isDirectory()) throw new UsageError(`${requested} is not a folder; pass the folder your build writes to`);

  const baselinePath = options.baseline ?? (options.updateBaseline === undefined ? config.baseline : undefined);
  if (baselinePath !== undefined && !existsSync(resolve(cwd, baselinePath))) throw new UsageError(`baseline file not found: ${baselinePath}. Create it with --update-baseline ${baselinePath}.`);

  const label = rootLabel(cwd, folder);
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
    ...(options.maxFindings === undefined ? {} : { maxFindings: options.maxFindings }),
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
  // machine formats (json, markdown, sarif, llm) must stay byte-identical to the plain text everywhere.
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
      appendHistory(cwd, buildHistoryRecord(report, { started: startedIso, configHash: runConfigHash(settings) }));
      return "";
    } catch (error) {
      return `seaworthy: could not record run history: ${error instanceof Error ? error.message : String(error)}\n`;
    }
  };

  const runFails = report.errors.length > 0 ? EXIT.internal : failing(report, failOn) ? EXIT.findings : EXIT.ok;
  return { code: runFails, stdout, stderr: crashedNotice(report.errors.length, "; see the report") + historyStderr() + timingText() };
}

/** `seaworthy config check [file] [options]`: validate a config without running checks. */
async function configCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  const [sub, ...rest] = args;
  if (sub === undefined || sub === "--help" || sub === "-h") return configHelp();
  if (sub !== "check") throw new UsageError(`unknown config command "${sub}"; use \`seaworthy config check\``);
  if (rest.includes("-h") || rest.includes("--help")) return configHelp();

  let file: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flag === "--config") {
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      const next = inline ?? rest[i + 1];
      if (next === undefined || next.startsWith("--")) throw new UsageError("--config needs a value");
      if (file !== undefined) throw new UsageError(`give the config file once, as a flag or as "${file}", not both`);
      file = next;
      if (inline === undefined) i++;
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError(`unknown option ${flag}`);
    if (file !== undefined) throw new UsageError(`unexpected argument "${arg}"; config check takes one file`);
    file = arg;
  }

  const cwd = env.cwd ?? process.cwd();
  const { config, file: resolved } = loadConfig(cwd, file, (env.checks ?? builtInChecks).map((c) => c.meta.id));
  if (resolved === undefined) {
    return {
      code: EXIT.ok,
      stdout: `seaworthy: no config found (looked for ${CONFIG_FILE}); verify would run with its defaults\n`,
      stderr: "",
    };
  }
  const counts: string[] = [];
  const entries = Object.keys(config.checks).length;
  if (entries > 0) counts.push(`${entries} check setting${entries === 1 ? "" : "s"}`);
  if (config.ignore.length > 0) counts.push(`${config.ignore.length} ignore glob${config.ignore.length === 1 ? "" : "s"}`);
  if (config.suppressions.length > 0) counts.push(`${config.suppressions.length} suppression${config.suppressions.length === 1 ? "" : "s"}`);
  const detail = counts.length > 0 ? ` (${counts.join(", ")})` : "";
  return { code: EXIT.ok, stdout: `seaworthy: ${file ?? CONFIG_FILE} is a valid config${detail}\n`, stderr: "" };
}

function configHelp(): CliResult {
  return { code: EXIT.ok, stdout: CONFIG_HELP, stderr: "" };
}

/**
 * `seaworthy init [dir] [--force]`: write the config, the CI workflow, and the empty baseline.
 * The plan is pure (init.ts); this layer only checks what exists, writes what the plan holds,
 * and prints exactly which file it wrote or kept. Non-interactive: it never asks and never edits.
 */
async function initCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  let dir: string | undefined;
  let force = false;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") return initHelp();
    if (arg === "--force") {
      if (force) throw new UsageError("pass --force once");
      force = true;
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError(`unknown option "${arg}"; seaworthy init takes only --force`);
    if (dir !== undefined) throw new UsageError(`unexpected argument "${arg}"; init takes one folder`);
    dir = arg;
  }

  const cwd = env.cwd ?? process.cwd();
  const base = resolve(cwd, dir ?? ".");
  if (!existsSync(base) || !statSync(base).isDirectory()) throw new UsageError(`${dir ?? "."} is not a folder`);
  const label = rootLabel(cwd, base);

  // Detection reads file names only: it never opens a user file, so an unparseable
  // generator config cannot crash init.
  const present = INIT_MARKERS.filter((name) => existsSync(resolve(base, name)));
  const detected = detectGenerator(present);
  const existing: PlanOptions["existing"] = {
    [CONFIG_FILE]: existsSync(resolve(base, CONFIG_FILE)),
    [WORKFLOW_FILE]: existsSync(resolve(base, WORKFLOW_FILE)),
    [BASELINE_FILE]: existsSync(resolve(base, BASELINE_FILE)),
  };

  const plan = planInit(detected, { existing, force });
  for (const write of plan.writes) {
    for (const folder of write.dirs) mkdirSync(resolve(base, folder), { recursive: true });
    writeFileSync(resolve(base, write.path), write.content);
  }

  const detection = detected === undefined ? `no generator detected; looked for ${INIT_MARKERS_HINT}` : `detected ${detected.name} from ${detected.marker}`;
  const fileWord = (n: number): string => (n === 1 ? "1 file" : `${n} files`);
  const wroteCount = plan.writes.length;
  const keptCount = plan.keeps.length;
  const lead =
    wroteCount === 0
      ? `seaworthy: init kept ${fileWord(keptCount)} already present in ${label} (${detection}); use --force to rewrite the files init owns`
      : keptCount === 0
        ? `seaworthy: init wrote ${fileWord(wroteCount)} in ${label} (${detection})`
        : `seaworthy: init wrote ${fileWord(wroteCount)}, kept ${fileWord(keptCount)} already present in ${label} (${detection})`;
  const lines = [
    lead,
    ...plan.writes.map((write) => `  wrote ${write.path} (${write.summary})`),
    ...plan.keeps.map((keep) => `  kept ${keep.path} (${keep.summary})`),
    `  next: ${plan.next}`,
  ];
  return { code: EXIT.ok, stdout: lines.join("\n") + "\n", stderr: "" };
}

function initHelp(): CliResult {
  return { code: EXIT.ok, stdout: INIT_HELP, stderr: "" };
}

/** `seaworthy diff before.json after.json`: one JSON object with the new, fixed, and unchanged findings. */
async function diff(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  if (args.length !== 2 || args.some((a) => a.startsWith("-"))) throw new UsageError(`diff takes exactly two report files: seaworthy diff before.json after.json`);
  const [beforePath, afterPath] = args as [string, string];
  const cwd = env.cwd ?? process.cwd();
  const diff = diffReports(readReport(resolve(cwd, beforePath)), readReport(resolve(cwd, afterPath)));
  const counts = diff.summary;
  const stderr = `seaworthy: ${counts.new} new, ${counts.fixed} fixed, ${counts.unchanged} unchanged finding${counts.new + counts.fixed + counts.unchanged === 1 ? "" : "s"}\n`;
  return { code: EXIT.ok, stdout: diffToJson(diff), stderr };
}

const FIX_HELP = `seaworthy fix

Preview the edits Seaworthy's fix suggestions would make: one unified diff, and no file is touched.

Usage:
  seaworthy fix [dir] [options]

Arguments:
  dir                  Built site folder. Default: the first of ${DEFAULT_FOLDERS.join(", ")} that exists.

Options:
  --dry-run            Print the unified diff of every suggested edit to stdout and change no
                       files. Running without it is an error: Seaworthy never writes or edits
                       files, so dry-run is the only mode.
  --config <file>      Config file. Default: ${CONFIG_FILE} in the current folder, if present
  --help, -h           Print this help

The diff is standard unified format with a/ and b/ paths relative to the site folder, so piping it to
\`git apply\` run from that folder applies it. Findings Seaworthy cannot turn into safe edits — manual
fixes, edits that need content only a person can supply (such as alt text), and edits whose anchor
text no longer matches the built file — are listed on stderr as manual guidance instead.

Exit codes:
  0  the preview completed (the diff may be empty when every fix is manual)
  2  usage error
  4  a check or the engine crashed
`;

/** `seaworthy fix [dir] --dry-run`: the checks again, then one unified diff of every suggested edit. */
async function fixCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  if (args.length === 0 || args.some((a) => a === "--help" || a === "-h")) return { code: EXIT.ok, stdout: FIX_HELP, stderr: "" };
  let dir: string | undefined;
  let dryRun = false;
  let config: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flag === "--dry-run") {
      if (eq !== -1) throw new UsageError("--dry-run is a flag and takes no value");
      dryRun = true;
      continue;
    }
    if (flag === "--config") {
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      const next = inline ?? args[i + 1];
      if (next === undefined || next.startsWith("--")) throw new UsageError("--config needs a value");
      if (config !== undefined) throw new UsageError(`give the config file once, as a flag or as "${config}", not both`);
      config = next;
      if (inline === undefined) i++;
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError(`unknown option ${flag}`);
    if (dir !== undefined) throw new UsageError(`unexpected argument "${arg}"; fix takes one folder`);
    dir = arg;
  }
  if (!dryRun) throw new UsageError("fix writes files without --dry-run, and Seaworthy never edits files. Pass --dry-run to preview every suggested edit as a unified diff.");

  const cwd = env.cwd ?? process.cwd();
  const checks = env.checks ?? builtInChecks;
  const { config: settings } = loadConfig(cwd, config, checks.map((c) => c.meta.id));
  const requested = dir ?? settings.root ?? DEFAULT_FOLDERS.find((name) => existsSync(resolve(cwd, name)) && statSync(resolve(cwd, name)).isDirectory());
  if (requested === undefined) throw new UsageError(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new UsageError(`${requested} is not a folder`);

  const site = buildSite(folder, settings.basePath === undefined ? {} : { basePath: settings.basePath });
  const { report } = await verifySite({ folder, site, rootLabel: rootLabel(cwd, folder), checks, config: settings });
  const preview = planFix(report.findings, (file) => {
    try {
      return readFileSync(join(folder, ...file.split("/")), "utf8");
    } catch {
      return undefined;
    }
  });

  const plural = (n: number): string => (n === 1 ? "" : "s");
  const summary = report.findings.length === 0 ? `seaworthy: no findings in ${rootLabel(cwd, folder)}; nothing to fix\n` : `seaworthy: ${preview.edits} edit${plural(preview.edits)} in ${preview.files} file${plural(preview.files)}; ${preview.manual.length} finding${plural(preview.manual.length)} need manual guidance\n`;
  const guidance = preview.manual.map((m) => {
    const at = m.location.line === undefined ? m.location.file : `${m.location.file}:${m.location.line}`;
    return `  ${m.checkId} (${m.severity}) ${at}: ${m.message} ${m.reason}. Fix: ${m.summary}`;
  });
  return {
    code: report.errors.length > 0 ? EXIT.internal : EXIT.ok,
    stdout: preview.diff,
    stderr: summary + (guidance.length > 0 ? guidance.join("\n") + "\n" : ""),
  };
}

export async function run(argv: readonly string[], env: CliEnvironment = {}): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { code: EXIT.ok, stdout: HELP, stderr: "" };
  if (command === "--version" || command === "-v") return { code: EXIT.ok, stdout: `${VERSION}\n`, stderr: "" };
  try {
    if (command === "verify") return await verify(rest, env);
    if (command === "init") return await initCommand(rest, env);
    if (command === "fix") return await fixCommand(rest, env);
    if (command === "diff") return await diff(rest, env);
    if (command === "config") return await configCommand(rest, env);
    return { code: EXIT.usage, stdout: "", stderr: `Unknown command: ${command}\n\n${HELP}` };
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof BaselineError || error instanceof ChangedError || error instanceof ReportDiffError) return { code: EXIT.usage, stdout: "", stderr: `seaworthy: ${error.message}\nRun \`seaworthy --help\` for usage.\n` };
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
