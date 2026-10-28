// `seaworthy fix [dir] --dry-run`: the checks again, then one unified diff of every suggested
// edit. Seaworthy never writes: dry-run is the only mode, and this module owns it.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { CONFIG_FILE, loadConfig } from "../config.js";
import { planFix } from "../fix.js";
import { builtInChecks } from "../checks/index.js";
import { buildSite } from "../site.js";
import { verifySite } from "../verify.js";
import { DEFAULT_FOLDERS, EXIT, rootLabel, UsageError, type CliEnvironment, type CliResult } from "./types.js";

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

export async function fixCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
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
