// `seaworthy diff before.json after.json`: one JSON object with the new, fixed, and unchanged findings.

import { resolve } from "node:path";

import { diffReports, diffToJson, readReport } from "../diff.js";
import { EXIT, UsageError, type CliEnvironment, type CliResult } from "./types.js";

export async function diffCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  if (args.length !== 2 || args.some((a) => a.startsWith("-"))) throw new UsageError(`diff takes exactly two report files: seaworthy diff before.json after.json`);
  const [beforePath, afterPath] = args as [string, string];
  const cwd = env.cwd ?? process.cwd();
  const diff = diffReports(readReport(resolve(cwd, beforePath)), readReport(resolve(cwd, afterPath)));
  const counts = diff.summary;
  const stderr = `seaworthy: ${counts.new} new, ${counts.fixed} fixed, ${counts.unchanged} unchanged finding${counts.new + counts.fixed + counts.unchanged === 1 ? "" : "s"}\n`;
  return { code: EXIT.ok, stdout: diffToJson(diff), stderr };
}
