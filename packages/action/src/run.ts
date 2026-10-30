// Executable entry the composite action.yml runs. Thin on purpose: every rule lives in
// ./index.js (inputs, threshold, SARIF naming, aggregate exit) or in the verify CLI's own
// contract, so this file only orchestrates the per-site verify invocations, the step output,
// and the exit code.

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ActionInputError,
  aggregateExit,
  parseInputs,
  ReportFormatError,
  sarifTargetFor,
  type ActionInputs,
  type Threshold,
} from "./index.js";
import { jobSummary, writeJobSummary } from "./summary.js";

/**
 * The verify CLI, built next to this package by the same `npm run build` the Action's build
 * step runs. Spawned as a process, not imported, so the Action runs the exact CLI its
 * `bin` publishes and the exit contract (0 ok, 1 findings, 2 usage, 4 crash) stays the
 * CLI's alone.
 */
const VERIFY_CLI = new URL("../../../verify/dist/src/cli.js", import.meta.url);

/** The exit code for a failed Action input or an unusable report; the CLI's own code otherwise. */
const USAGE_EXIT = 2;

/** The CLI's exit code for "the site has findings at or above the threshold". */
const FINDINGS_EXIT = 1;

/** The CLI's exit code for "a check or the engine crashed". */
const CRASH_EXIT = 4;

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

/**
 * `verify` with the report format left open: the directory arg is skipped so the CLI discovers a default.
 * The threshold travels as `--fail-on`, so the CLI decides the exit code from the same severity the
 * Action input names; the run's outcome is the CLI's, never a second rule in this package.
 *
 * `--markdown` goes last because its value list runs until the next `--flag`: the site folder and the
 * two named options are then already parsed. With no Markdown paths the flag is absent, so the
 * `md.*` checks walk the built folder exactly as they do on the command line.
 */
function verifyArgs(site: string, format: string, failOn: Threshold, out?: string, markdown: readonly string[] = []): string[] {
  const args = ["verify", ...(site === "" ? [] : [site]), "--format", format, "--fail-on", failOn];
  const withOut = out === undefined ? args : [...args, "--out", out];
  return markdown.length === 0 ? withOut : [...withOut, "--markdown", ...markdown];
}

/** Report JSON text -> parsed, as far as the Action log line and the job summary trust it (never re-checked in detail). */
function readReport(stdout: string): { summary?: { findings?: number }; root?: string; findings?: unknown[]; errors?: unknown[] } {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new ReportFormatError("the verify CLI did not print a JSON report on stdout");
  }
}

/** The findings-and-SARIF wording of a report the CLI printed. */
function reportNote(report: { summary?: { findings?: number }; root?: string; errors?: unknown[] }, sarifFile: string, sarifDisabled: boolean): string {
  const findings = report.summary?.findings ?? 0;
  const crashed = (report.errors ?? []).length;
  const sarifNote = sarifDisabled ? "sarif disabled" : sarifFile === "" ? "no sarif written" : `sarif written to ${sarifFile}`;
  return `${findings} finding${findings === 1 ? "" : "s"} in ${report.root ?? ""}, ${crashed} crashed check${crashed === 1 ? "" : "s"}; ${sarifNote}`;
}

/**
 * One Action run: verify every site named by the `site` input — one CLI invocation per site —
 * write SARIF when the `sarif` input says so (one file per site, named by `sarifTargets`), set
 * the `sarif` step output, and return the exit contract. Relative paths resolve against the
 * consumer's workspace, the folder the workflow checked out.
 *
 * One site: the pre-multi-site path, byte for byte. Several sites: no site's outcome hides
 * another's findings; the aggregate rule in index.js (`aggregateExit`) decides the run's code.
 *
 * The job summary (issue #260) rides on the same report JSON the log line already reads: it is
 * appended to `$GITHUB_STEP_SUMMARY` when the `summary` input is `on` — once for the site of a
 * single-site run, once per site for several — and a summary that cannot be written changes nothing
 * but itself.
 */
export async function actionRun(env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  const inputs = parseInputs(env);
  const cwd = env.GITHUB_WORKSPACE ?? process.cwd();
  if (inputs.sites.length <= 1) return singleSiteRun(inputs, inputs.sites[0] ?? "", cwd, env);
  return multiSiteRun(inputs, cwd, env);
}

/** The original single-site run, kept byte-identical for existing consumers: one site, one report, one exit code. */
async function singleSiteRun(inputs: ActionInputs, site: string, cwd: string, env: Readonly<Record<string, string | undefined>>): Promise<number> {
  const json = runVerify(verifyArgs(site, "json", inputs.threshold, undefined, inputs.markdown), cwd);
  if (json.code === USAGE_EXIT) return json.code;
  const report = readReport(json.stdout);

  // The job summary (issue #260): the run page's `$GITHUB_STEP_SUMMARY`, built from the report JSON
  // this run already has. It is write-only for the verdict — a summary that cannot be rendered or
  // written costs the run nothing, because the exit code below is the CLI's and never this one's.
  // `summary: off` skips it, which is what a workflow that only wants the exit code had before.
  if (inputs.summary === "on") writeJobSummary(jobSummary(report), env);

  if (inputs.sarif !== "") {
    const sarif = runVerify(verifyArgs(site, "sarif", inputs.threshold, inputs.sarif, inputs.markdown), cwd);
    // 1 is the CLI's "the site has findings" code: the run failed on the site's problems, not on
    // the SARIF write, and the JSON run above already decided that outcome. Anything else is the
    // SARIF run itself failing, which the Action reports as its own failure.
    if (sarif.code !== 0 && sarif.code !== FINDINGS_EXIT) return sarif.code === USAGE_EXIT ? USAGE_EXIT : CRASH_EXIT;
  }

  if (env.GITHUB_OUTPUT !== undefined) {
    appendFileSync(env.GITHUB_OUTPUT, `sarif=${inputs.sarif}\n`);
  }
  process.stdout.write(`seaworthy: ${reportNote(report, inputs.sarif, inputs.sarif === "")}\n`);
  process.stderr.write(json.stderr);
  return json.code;
}

/** What one site of a multi-site run ended up as. */
interface SiteOutcome {
  readonly site: string;
  readonly code: number;
  /** Findings from the run's report, 0 when the run never produced one. */
  readonly findings: number;
  /** The site folder as the report names it. */
  readonly root: string;
  /** Crashed checks from the run's report, 0 when the run never produced one. */
  readonly crashed: number;
  /** The SARIF file this site's run wrote, or "" when SARIF is disabled or never got to run. */
  readonly sarifFile: string;
  /** A failure the report numbers cannot express: the CLI rejected the run, or crashed without one. */
  readonly note: string;
}

/**
 * Several sites, one run each, all reported. The run fails if any site fails: the log names
 * every site with its own findings count and its own SARIF file, then one summary line says
 * which sites failed at the threshold and with how many findings, which crashed (exit 4 stays
 * a crash, never folded into "a site failed"), and which were rejected (exit 2); the process
 * exits with `aggregateExit` of the per-site codes. Sites are verified as folders relative to
 * the workspace, never outside it, and the Action runs no build and never executes site content.
 */
async function multiSiteRun(inputs: ActionInputs, cwd: string, env: Readonly<Record<string, string | undefined>>): Promise<number> {
  const outcomes: SiteOutcome[] = [];
  for (const site of inputs.sites) {
    const json = runVerify(verifyArgs(site, "json", inputs.threshold, undefined, inputs.markdown), cwd);
    if (json.code === USAGE_EXIT) {
      outcomes.push({ site, code: USAGE_EXIT, findings: 0, root: site, crashed: 0, sarifFile: "", note: "the CLI rejected this run (exit 2)" });
      process.stderr.write(json.stderr);
      continue;
    }
    let report: ReturnType<typeof readReport>;
    try {
      report = readReport(json.stdout);
    } catch {
      // The CLI died without a report to read: that is its crash exit code, reported as itself.
      outcomes.push({ site, code: CRASH_EXIT, findings: 0, root: site, crashed: 0, sarifFile: "", note: "the verify CLI crashed without a report (exit 4)" });
      process.stderr.write(json.stderr);
      continue;
    }
    // One section per site in the same job summary file; the heading names the folder. As in the
    // single-site path, a summary that cannot be written costs the run nothing.
    if (inputs.summary === "on") writeJobSummary(jobSummary(report, site), env);
    let code = json.code;
    let sarifFile = "";
    if (inputs.sarif !== "") {
      const target = sarifTargetFor(site, inputs.sarif);
      const sarif = runVerify(verifyArgs(site, "sarif", inputs.threshold, target, inputs.markdown), cwd);
      // As in the single-site path, 1 means the site's findings failed it, not the SARIF write.
      if (sarif.code === 0 || sarif.code === FINDINGS_EXIT) sarifFile = target;
      else code = sarif.code === USAGE_EXIT ? USAGE_EXIT : CRASH_EXIT;
    }
    outcomes.push({
      site,
      code,
      findings: report.summary?.findings ?? 0,
      root: report.root ?? site,
      crashed: (report.errors ?? []).length,
      sarifFile,
      note: "",
    });
    process.stderr.write(json.stderr);
  }

  const overall = aggregateExit(outcomes.map((outcome) => outcome.code));
  if (env.GITHUB_OUTPUT !== undefined) {
    writeStepOutput(env.GITHUB_OUTPUT, "sarif", outcomes.map((outcome) => outcome.sarifFile).filter((file) => file !== "").join("\n"));
  }
  for (const outcome of outcomes) {
    const detail =
      outcome.note !== ""
        ? outcome.note
        : `${outcome.findings} finding${outcome.findings === 1 ? "" : "s"} in ${outcome.root}, ${outcome.crashed} crashed check${outcome.crashed === 1 ? "" : "s"}; ${
            inputs.sarif === "" ? "sarif disabled" : outcome.sarifFile === "" ? "no sarif written" : `sarif written to ${outcome.sarifFile}`
          }`;
    process.stdout.write(`seaworthy ${outcome.site}: ${detail}\n`);
  }
  process.stdout.write(summaryLine(outcomes, overall) + "\n");
  return overall;
}

/** The closing line: which sites failed at the threshold, with how many findings, crashed, or were rejected. */
function summaryLine(outcomes: readonly SiteOutcome[], overall: number): string {
  const failed = outcomes.filter((o) => o.code === FINDINGS_EXIT);
  const crashed = outcomes.filter((o) => o.code === CRASH_EXIT);
  const rejected = outcomes.filter((o) => o.code === USAGE_EXIT);
  const parts: string[] = [`seaworthy: ${outcomes.length} sites verified`];
  if (failed.length > 0) parts.push(`${failed.length} failed at the threshold (${failed.map((o) => `${o.site}: ${o.findings} finding${o.findings === 1 ? "" : "s"}`).join(", ")})`);
  if (crashed.length > 0) parts.push(`${crashed.length} crashed (${crashed.map((o) => `${o.site}: exit ${CRASH_EXIT}`).join(", ")})`);
  if (rejected.length > 0) parts.push(`${rejected.length} rejected (${rejected.map((o) => o.site).join(", ")})`);
  parts.push(`overall exit ${overall}`);
  return parts.join(", ");
}

/** A step output value that may span lines: the delimiter form keeps several paths inside one output. */
function writeStepOutput(file: string, name: string, value: string): void {
  if (!value.includes("\n")) {
    appendFileSync(file, `${name}=${value}\n`);
    return;
  }
  const delimiter = "seaworthy_output_delim";
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
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
