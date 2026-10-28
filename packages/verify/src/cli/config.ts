// `seaworthy config check [file] [options]`: validate a config without running checks.

import { builtInChecks } from "../checks/index.js";
import { CONFIG_FILE, loadConfig } from "../config.js";
import { EXIT, UsageError, type CliEnvironment, type CliResult } from "./types.js";

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

function configHelp(): CliResult {
  return { code: EXIT.ok, stdout: CONFIG_HELP, stderr: "" };
}

export async function configCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
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
