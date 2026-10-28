// Executable entry the composite action.yml runs. Thin on purpose: every rule lives in
// ./index.js (inputs, threshold, SARIF mapping) or in the verify CLI's own contract, so
// this file only orchestrates two verify invocations, the step output, and the exit code.

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ActionInputError, parseInputs, ReportFormatError } from "./index.js";

/**
 * The verify CLI, built next to this package by the same `npm run build` the Action's build
 * step runs. Spawned as a process, not imported, so the Action runs the exact CLI its
 * `bin` publishes and the exit contract (0 ok, 1 findings, 2 usage, 4 crash) stays the
 * CLI's alone.
 */
const VERIFY_CLI = new URL("../../../verify/dist/src/cli.js", import.meta.url);

/** The exit code for a failed Action input or an unusable report; the CLI's own code otherwise. */
const USAGE_EXIT = 2;

interface VerifyRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** One CLI run with node, synchronously; the child's text is captured for the report and the log. */
function runVerify(args: readonly string[], cwd: string): VerifyRun {
  const run = spawnSync(process.execPath, [fileURLToPath(VERIFY_CLI), ...args], { cwd, encoding: "utf8" });
  if (run.error !== undefined) throw new Error(`could not start the verify CLI: ${run.error.message}`);
  return { code: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** `verify` with the report format left open: the directory arg is skipped so the CLI discovers a default. */
function verifyArgs(site: string, format: string, out?: string): string[] {
  const args = ["verify", ...(site === "" ? [] : [site]), "--format", format];
  return out === undefined ? args : [...args, "--out", out];
}

/** Report JSON text -> parsed, as far as the Action log line trusts it (never re-checked in detail). */
function readReport(stdout: string): { summary?: { findings?: number }; root?: string; errors?: unknown[] } {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new ReportFormatError("the verify CLI did not print a JSON report on stdout");
  }
}

/**
 * One Action run: verify the site, write SARIF when the `sarif` input says so, set the
 * `sarif` step output, and return the exit contract (0, 1, or 4). Relative paths resolve
 * against the consumer's workspace, the folder the workflow checked out.
 *
 * SARIF is written by the CLI itself (`--format sarif --out`) rather than mapped here,
 * because only the CLI's in-run site text can turn fix edits into exact regions.
 */
export async function actionRun(env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  const inputs = parseInputs(env);
  const cwd = env.GITHUB_WORKSPACE ?? process.cwd();
  const json = runVerify(verifyArgs(inputs.site, "json"), cwd);
  if (json.code === USAGE_EXIT) return json.code;
  const report = readReport(json.stdout);

  if (inputs.sarif !== "") {
    const sarif = runVerify(verifyArgs(inputs.site, "sarif", inputs.sarif), cwd);
    if (sarif.code !== 0) return sarif.code === USAGE_EXIT ? USAGE_EXIT : 4;
  }

  if (env.GITHUB_OUTPUT !== undefined) {
    appendFileSync(env.GITHUB_OUTPUT, `sarif=${inputs.sarif}\n`);
  }
  const findings = report.summary?.findings ?? 0;
  const crashed = (report.errors ?? []).length;
  const sarifNote = inputs.sarif === "" ? "sarif disabled" : `sarif written to ${inputs.sarif}`;
  process.stdout.write(`seaworthy: ${findings} finding${findings === 1 ? "" : "s"} in ${report.root}, ${crashed} crashed check${crashed === 1 ? "" : "s"}; ${sarifNote}\n`);
  process.stderr.write(json.stderr);
  return json.code;
}

/** Run only when this file is node's entry, not when tests import it. */
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  actionRun().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`seaworthy: ${error instanceof ActionInputError || error instanceof ReportFormatError ? error.message : String(error)}\n`);
      process.exitCode = USAGE_EXIT;
    },
  );
}
