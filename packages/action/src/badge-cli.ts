// seaworthy-badge: writes the Seaworthy status badge from a verify report.
//
//   seaworthy verify --format json --out seaworthy-report.json
//   seaworthy-badge --report seaworthy-report.json --out seaworthy-badge.svg
//
// The report JSON is untrusted input: parsed, never evaluated. Served by GitHub from the committed
// file; see docs/badge.md.

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { badgeForReport, writeBadgeFile, README_SNIPPET } from "./badge.js";

const HELP = `seaworthy-badge — write the Seaworthy status badge from a verify report

Usage:
  seaworthy-badge [options]

Reads a report from \`seaworthy verify --format json\` (a file, or stdin) and writes the status
badge SVG (a file, or stdout). Deterministic: the same report always produces the same SVG bytes,
so a CI commit and a GitHub rerun of it are identical.

Options:
  --report <file>    Verify report to read (JSON). Default: stdin
  --out <file>       Where to write the SVG. Default: stdout
  --readme           Print the README snippet instead of a badge
  --help, -h         Print this help
  --version, -v      Print the version

Exit codes:
  0  the badge was written
  2  usage error; or the report is unreadable, is not JSON, or is not a Seaworthy report

Status: pre-alpha. See docs/badge.md and ROADMAP.md.
`;

class UsageError extends Error {}
class HelpRequested extends Error {}
class VersionRequested extends Error {}

// dist/src/badge-cli.js is three levels below this package (dist/src → package);
// the walk-up below covers src/ during tests too.
function packageJsonPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("seaworthy-badge: package.json not found above this script");
}

const VERSION = `@seaworthy/action ${JSON.parse(readFileSync(packageJsonPath(), "utf8")).version}`;

export interface BadgeCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface BadgeOptions {
  report: string | undefined;
  out: string | undefined;
  readme: boolean;
}

function parseOptions(args: readonly string[]): BadgeOptions {
  const options: BadgeOptions = { report: undefined, out: undefined, readme: false };
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
      case "--report": {
        const [v, next] = value(flag, inline, i);
        options.report = v;
        i = next;
        break;
      }
      case "--out": {
        const [v, next] = value(flag, inline, i);
        options.out = v;
        i = next;
        break;
      }
      case "--readme":
        options.readme = true;
        break;
      case "--help":
      case "-h":
        throw new HelpRequested();
      case "--version":
      case "-v":
        throw new VersionRequested();
      default:
        throw new UsageError(`unknown argument ${flag}`);
    }
  }
  return options;
}

/** Reads the report as text from --report, or stdin when it is unset. */
async function readReport(report: string | undefined, stdin?: string): Promise<string> {
  if (report === undefined) {
    if (stdin !== undefined) return stdin;
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(report, "utf8").catch(() => {
    throw new UsageError(`cannot read --report ${report}`);
  });
}

/** One badge run: arguments in, exit state out. The only side effect is the file `--out` names. */
export async function run(argv: readonly string[], env: { stdin?: string } = {}): Promise<BadgeCliResult> {
  let options: BadgeOptions;
  try {
    options = parseOptions(argv);
  } catch (error) {
    if (error instanceof HelpRequested) return { code: 0, stdout: HELP, stderr: "" };
    if (error instanceof VersionRequested) return { code: 0, stdout: VERSION, stderr: "" };
    return { code: 2, stdout: "", stderr: `seaworthy: ${(error as Error).message}\nRun \`seaworthy-badge --help\` for usage.\n` };
  }
  try {
    if (options.readme) {
      return { code: 0, stdout: `${README_SNIPPET}\n`, stderr: "" };
    }
    const text = await readReport(options.report, env.stdin);
    let report: unknown;
    try {
      report = JSON.parse(text);
    } catch {
      throw new UsageError(`${options.report === undefined ? "stdin" : `--report ${options.report}`} is not JSON`);
    }
    const badge = await badgeForReport(report);
    if (options.out === undefined) return { code: 0, stdout: badge.svg, stderr: "" };
    await writeBadgeFile(badge.svg, options.out);
    return { code: 0, stdout: "", stderr: `${options.out}: ${badge.state}${badge.count === undefined ? "" : ` (${badge.count})`}\n` };
  } catch (error) {
    if (error instanceof UsageError) return { code: 2, stdout: "", stderr: `seaworthy: ${error.message}\nRun \`seaworthy-badge --help\` for usage.\n` };
    return { code: 2, stdout: "", stderr: `seaworthy: ${error instanceof Error ? error.message : String(error)}\n` };
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
