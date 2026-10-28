// The dispatcher: routes one invocation to its command module and maps errors to exit codes.
// Each command owns one module (verify, init, fix, diff, config); this file owns only routing,
// the root `--help` and `--version`, and the shared error-to-exit-code mapping. Each route
// imports just the module it needs, so `--version` never loads the engine: ADR 0004 budgets
// that invocation at 150 ms.

import { BaselineError } from "../baseline.js";
import { ChangedError } from "../changed.js";
import { ConfigError } from "../config.js";
import { ReportDiffError } from "../diff.js";
import { VERSION } from "../version.js";
import { EXIT, UsageError, type CliEnvironment, type CliResult } from "./types.js";

export async function run(argv: readonly string[], env: CliEnvironment = {}): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { code: EXIT.ok, stdout: (await import("./help.js")).HELP, stderr: "" };
  if (command === "--version" || command === "-v") return { code: EXIT.ok, stdout: `${VERSION}\n`, stderr: "" };
  try {
    if (command === "verify") return await (await import("./verify.js")).verifyCommand(rest, env);
    if (command === "init") return await (await import("./init.js")).initCommand(rest, env);
    if (command === "fix") return await (await import("./fix.js")).fixCommand(rest, env);
    if (command === "diff") return await (await import("./diff.js")).diffCommand(rest, env);
    if (command === "config") return await (await import("./config.js")).configCommand(rest, env);
    return { code: EXIT.usage, stdout: "", stderr: `Unknown command: ${command}\n\n${(await import("./help.js")).HELP}` };
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof BaselineError || error instanceof ChangedError || error instanceof ReportDiffError) return { code: EXIT.usage, stdout: "", stderr: `seaworthy: ${error.message}\nRun \`seaworthy --help\` for usage.\n` };
    return { code: EXIT.internal, stdout: "", stderr: `seaworthy: ${error instanceof Error ? error.message : String(error)}\n` };
  }
}
