#!/usr/bin/env node
// `seaworthy` command: `seaworthy verify [dir]`, `--help`, `--version`.

import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { builtInChecks } from "./checks/index.js";
import { runChecks } from "./engine.js";
import { FORMATS, type Format, formatReport } from "./formats/index.js";
import { SEVERITY_ORDER, severityCounts } from "./formats/pretty.js";
import { buildReport } from "./report.js";
import { buildSite } from "./site.js";
import type { Check, Report, Severity } from "./types.js";
import { VERSION } from "./version.js";

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
  --rendered           Run checks that need a browser
  --network            Run checks that make network requests
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
}

interface Options {
  dir: string | undefined;
  format: Format;
  out: string | undefined;
  failOn: Severity | "none";
  rendered: boolean;
  network: boolean;
}

class UsageError extends Error {}

function parseOptions(args: readonly string[]): Options {
  const options: Options = { dir: undefined, format: "pretty", out: undefined, failOn: "error", rendered: false, network: false };
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
      case "--rendered":
        options.rendered = true;
        break;
      case "--network":
        options.network = true;
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

function failing(report: Report, failOn: Options["failOn"]): boolean {
  if (failOn === "none") return false;
  return report.findings.some((f) => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[failOn]);
}

async function verify(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  const options = parseOptions(args);
  const cwd = env.cwd ?? process.cwd();
  const checks = env.checks ?? builtInChecks;

  const requested = options.dir ?? DEFAULT_FOLDERS.find((name) => existsSync(resolve(cwd, name)) && statSync(resolve(cwd, name)).isDirectory());
  if (requested === undefined) throw new UsageError(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new UsageError(`${requested} is not a folder`);

  const site = buildSite(folder);
  const result = await runChecks({ site, checks, enable: { browser: options.rendered, network: options.network } });
  const report = buildReport({ root: rootLabel(cwd, folder), pages: site.pages.size, checks, findings: result.findings, skipped: result.skipped, errors: result.errors });

  const text = formatReport(report, options.format, {
    readLine: (file, line) => site.pages.get(`/${file}`)?.source.split(/\r?\n/)[line - 1],
  });
  let stdout = text;
  if (options.out !== undefined) {
    const target = resolve(cwd, options.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    const counts = severityCounts(report);
    stdout = `seaworthy: ${report.findings.length === 0 ? "no findings" : `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} (${counts})`}; ${options.format} report written to ${options.out}\n`;
  }
  const code = report.errors.length > 0 ? EXIT.internal : failing(report, options.failOn) ? EXIT.findings : EXIT.ok;
  return { code, stdout, stderr: report.errors.length > 0 ? `seaworthy: ${report.errors.length} check${report.errors.length === 1 ? "" : "s"} crashed; see the report\n` : "" };
}

export async function run(argv: readonly string[], env: CliEnvironment = {}): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { code: EXIT.ok, stdout: HELP, stderr: "" };
  if (command === "--version" || command === "-v") return { code: EXIT.ok, stdout: `${VERSION}\n`, stderr: "" };
  try {
    if (command === "verify") return await verify(rest, env);
    return { code: EXIT.usage, stdout: "", stderr: `Unknown command: ${command}\n\n${HELP}` };
  } catch (error) {
    if (error instanceof UsageError) return { code: EXIT.usage, stdout: "", stderr: `seaworthy: ${error.message}\nRun \`seaworthy --help\` for usage.\n` };
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
  const result = await run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
