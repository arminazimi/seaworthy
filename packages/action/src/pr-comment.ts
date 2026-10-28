// PR-comment pieces of the Seaworthy GitHub Action (issue #89, `action.pr-comment`).
//
// The `new` and `fixed` findings come from Seaworthy's own diff (`readReport` +
// `diffReports` from @seaworthy/verify — no re-implemented diffing), and the body is the
// deterministic `formatDiffComment`. This module is only the thin wiring the Action needs:
// build the body from two report files, write it, and post it with `gh` when the Action runs.
//
// It is a small executable so the composite `action.yml` maintained by `action.core` can
// call the pieces as plain steps, without either task touching the other's files:
//
//   node dist/src/pr-comment.js body --before base.json --after head.json --out .seaworthy/comment.md
//   node dist/src/pr-comment.js post --repo ${{ github.repository }} --pr ${{ github.event.pull_request.number }} --body-file .seaworthy/comment.md

import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { diffReports, formatDiffComment, readReport } from "@seaworthy/verify";

export const EXIT = {
  ok: 0,
  usage: 2,
  /** A step crashed: a report could not be read, or gh failed. */
  internal: 4,
} as const;

/** Where the comment body is stored by default, relative to where the Action runs. */
export const COMMENT_FILE = join(".seaworthy", "comment.md");

const USAGE = `seaworthy action pr-comment

Commands:
  pr-comment body --before <report.json> --after <report.json> [--out <file>]
                      Diff the two reports and write the comment body (default: ${COMMENT_FILE})
  pr-comment post --repo <owner/name> --pr <number> --body-file <file>
                      Post the comment with gh (needs GH_TOKEN)
`;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommentInput {
  /** The repository that gets the comment, as `owner/name`. */
  repo: string;
  /** The pull request that gets the comment. */
  pr: string | number;
  /** Where the comment body was written. */
  bodyFile: string;
}

/** The exact `gh` argument list. The order is part of the contract; tests assert it. */
export function prCommentArgs(input: CommentInput): string[] {
  return ["pr", "comment", String(input.pr), "--repo", input.repo, "--body-file", input.bodyFile];
}

export type GhRunner = (argv: readonly string[]) => RunResult;

export class GhError extends Error {}

/** Runs `gh` for real. Never reached in unit tests: they inject a fake runner. */
export const gh: GhRunner = (argv) => {
  try {
    return { code: EXIT.ok, stdout: execFileSync("gh", [...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" };
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
    throw new GhError(`gh failed: ${stderr || (error instanceof Error ? error.message : String(error))}`);
  }
};

/** The comment body for what changed between two report files: counts, then new, then fixed. */
export function commentBody(before: string, after: string, cwd: string = process.cwd()): string {
  return formatDiffComment(diffReports(readReport(resolve(cwd, before)), readReport(resolve(cwd, after))));
}

/** Writes the comment body for the next step, returning the path it was written to. */
export function writeCommentBody(comment: string, file: string = COMMENT_FILE, cwd: string = process.cwd()): string {
  const target = resolve(cwd, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, comment);
  return target;
}

export class UsageError extends Error {}

/**
 * The two composite steps for `action.yml`, as data: `action.core` owns the workflow
 * file, so carrying the wiring here keeps the two tasks mergeable instead of overlapping.
 */
export interface CommentStep {
  name: string;
  run: string;
}

export interface PrCommentStepsInput extends CommentInput {
  before: string;
  after: string;
  /** Where the built action sits in the workflow's filesystem. Default: the action's own checkout. */
  entry?: string;
}

export function prCommentSteps(input: PrCommentStepsInput): readonly CommentStep[] {
  const node = `node "${input.entry ?? "${{ github.action_path }}/dist/src/pr-comment.js"}"`;
  return [
    { name: "Build the Seaworthy comment body", run: `${node} body --before ${input.before} --after ${input.after} --out ${input.bodyFile}` },
    { name: "Post the Seaworthy comment", run: `${node} post --repo ${input.repo} --pr "${input.pr}" --body-file ${input.bodyFile}` },
  ];
}

const FLAGS: Record<"body" | "post", readonly string[]> = { body: ["before", "after", "out"], post: ["repo", "pr", "body-file"] };

/** Parses `--flag value` or `--flag=value` pairs. Untrusted argv: parsed, never evaluated. */
function parseOptions(argv: readonly string[], flags: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    if (!raw.startsWith("--")) throw new UsageError(`this command takes options only, not "${raw}"`);
    const flag = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    if (flag === "" || !flags.includes(flag)) throw new UsageError(`unknown option --${flag}; use ${flags.map((f) => `--${f} <value>`).join(" ")}`);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    const value = inline ?? argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`--${flag} needs a value`);
    if (values[flag] !== undefined) throw new UsageError(`--${flag} was given twice`);
    values[flag] = value;
    if (inline === undefined) i++;
  }
  return values;
}

function bodyCommand(argv: readonly string[], cwd: string): RunResult {
  const values = parseOptions(argv, FLAGS.body);
  if (values.before === undefined || values.after === undefined) throw new UsageError("body needs --before and --after");
  const comment = commentBody(values.before, values.after, cwd);
  writeCommentBody(comment, values.out ?? COMMENT_FILE, cwd);
  return { code: EXIT.ok, stdout: `seaworthy: comment body written to ${values.out ?? COMMENT_FILE}\n`, stderr: "" };
}

function postCommand(argv: readonly string[], run: GhRunner): RunResult {
  const values = parseOptions(argv, FLAGS.post);
  if (values.repo === undefined || values.pr === undefined || values["body-file"] === undefined) throw new UsageError("post needs --repo, --pr, and --body-file");
  const result = run(prCommentArgs({ repo: values.repo, pr: values.pr, bodyFile: values["body-file"] }));
  return { code: EXIT.ok, stdout: result.stdout, stderr: result.stderr };
}

/** The `pr-comment` command's entry point, isolated so unit tests can call it with a fake gh. */
export function run(argv: readonly string[], env: { cwd?: string; gh?: GhRunner } = {}): RunResult {
  const command = argv[0];
  const rest = argv.slice(1);
  try {
    if (command === "body") return bodyCommand(rest, env.cwd ?? process.cwd());
    if (command === "post") return postCommand(rest, env.gh ?? gh);
    return {
      code: EXIT.usage,
      stdout: "",
      stderr: `seaworthy action: unknown command "${command ?? ""}"; use body or post\n${USAGE}`,
    };
  } catch (error) {
    if (error instanceof UsageError) return { code: EXIT.usage, stdout: "", stderr: `seaworthy action: ${error.message}\n${USAGE}` };
    return { code: EXIT.internal, stdout: "", stderr: `seaworthy action: ${error instanceof Error ? error.message : String(error)}\n` };
  }
}

// Run only when executed directly (by the Action's steps), not when imported by tests.
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
  const result = run(process.argv.slice(2), { cwd: process.cwd() });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
