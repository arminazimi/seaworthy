// Unit tests for the inline-annotation layer of the Action (issue #259). They run offline: the git
// calls are injected fakes except the end-to-end cases at the bottom, which build a real throwaway
// repository the way packages/verify/tests/changed.test.ts does.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import { SEVERITIES, builtInChecks, type Finding } from "@seaworthy/verify";

import {
  ANNOTATION_LEVEL,
  MAX_ANNOTATIONS,
  SKIP_REASON_TEXT,
  annotationCommand,
  checkoutLineChecker,
  escapeMessage,
  escapeProperty,
  lineCount,
  planAnnotations,
  pullRequestContext,
  repoPath,
  summarySection,
} from "../src/annotations.js";
import { actionRun } from "../src/run.js";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    checkId: "links.internal",
    severity: "error",
    message: "Link to /nope.html points to a page that does not exist.",
    location: { file: "index.html", line: 4, column: 10 },
    fix: { kind: "manual", summary: "Point the link at /docs.html.", edits: [], appliesTo: "built-output" },
    fingerprint: "f1",
    ...over,
  } as Finding;
}

/** `count` findings of the same location, each with its own fingerprint. */
function many(count: number, over: Partial<Finding> = {}): Finding[] {
  return Array.from({ length: count }, (_, index) => finding({ severity: "error", fingerprint: `f${index}`, ...over }));
}

const always = () => true;
const reasons = (entries: readonly { reason: string }[]): string[] => entries.map((entry) => entry.reason);

test("the three report severities map to the three annotation levels GitHub renders, and no fourth is invented", () => {
  assert.deepEqual(SEVERITIES.map((severity) => ANNOTATION_LEVEL[severity]), ["error", "warning", "notice"]);
  assert.deepEqual(Object.keys(ANNOTATION_LEVEL).sort(), [...SEVERITIES].sort());
  assert.equal(
    annotationCommand(finding({ severity: "warning" }), "dist/index.html", 4, 10),
    "::warning file=dist/index.html,line=4,col=10::links.internal: Link to /nope.html points to a page that does not exist. Fix: Point the link at /docs.html.",
  );
  assert.match(annotationCommand(finding({ severity: "note", location: { file: "a.md", line: 1 } }), "README.md", 1, undefined), /^::notice file=README\.md,line=1::/);
});

test("the finding's own message travels in full, with its fix hint when it has one", () => {
  const noHint = finding({ fix: { kind: "manual", summary: "", edits: [], appliesTo: "built-output" } });
  assert.ok(annotationCommand(noHint, "dist/index.html", 4, undefined).endsWith("::links.internal: Link to /nope.html points to a page that does not exist."));
});

test("the repository path is the report root joined with the site-relative file, unencoded", () => {
  assert.equal(repoPath("dist", "index.html"), "dist/index.html");
  assert.equal(repoPath("./dist", "blog/post.html"), "dist/blog/post.html");
  assert.equal(repoPath(".", "index.html"), "index.html");
  // git names paths literally, so the annotation must not URI-encode them the way the SARIF uri does.
  assert.equal(repoPath("dist", "a b/c&d.html"), "dist/a b/c&d.html");
});

test("workflow-command escaping: data loses % and the line breaks, a parameter value also loses ] and :", () => {
  assert.equal(escapeMessage("100% done\r\nsee [notes]\nend"), "100%25 done%0D%0Asee [notes]%0Aend");
  assert.equal(escapeProperty("dist/a:b[c].html"), "dist/a%3Ab[c%5D.html");
  // an escaped `%` is never escaped twice: the table is applied in a single pass
  assert.equal(escapeProperty("100%25.html"), "100%2525.html");

  // The injection surface: a message that tries to close the property list, open a second command,
  // and break onto a new line. The line stays one line, and its header stays the header.
  const hostile = finding({ message: 'x"] ::error file=sensitive.env,line=1::pwned\r\n%done]' });
  const command = annotationCommand(hostile, "dist/index.html", 3, undefined);
  assert.equal(
    command,
    '::error file=dist/index.html,line=3::links.internal: x"] ::error file=sensitive.env,line=1::pwned%0D%0A%25done] Fix: Point the link at /docs.html.',
  );
  assert.equal(command.split("\n").length, 1, "one command is one line, whatever the message held");
  assert.match(command, /^::error file=dist\/index\.html,line=3::/, "the parameters cannot be rewritten by the message: they are closed before the data starts");
});

test("a finding with no real line goes to the summary channel, never to a guessed line", () => {
  const selectorOnly = finding({ location: { file: "index.html", selector: "#main img" } });
  const pageLevel = finding({ location: { file: "sitemap.xml" } });
  const zeroLine = finding({ location: { file: "index.html", line: 0 } });
  const plan = planAnnotations({ root: "dist", findings: [selectorOnly, pageLevel, zeroLine], changed: new Set(["dist/index.html", "dist/sitemap.xml"]), lineInCheckout: always });
  assert.deepEqual(plan.annotations, []);
  assert.deepEqual(reasons(plan.summarized), ["no-location", "no-location", "no-location"]);
});

test("a file the pull request did not touch is not annotated, even when it is tracked and on disk", () => {
  const plan = planAnnotations({ root: "dist", findings: [finding({ severity: "error" })], changed: new Set(["dist/other.html"]), lineInCheckout: always });
  assert.deepEqual(plan.annotations, []);
  assert.equal(plan.summarized[0]?.reason, "not-touched");
});

test("a line that is not in the checked-out file is not annotated", () => {
  const root = mkdtempSync(join(tmpdir(), "seaworthy-annotations-"));
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "index.html"), "<!doctype html>\n<html>\n<body></body>\n</html>\n");
  const lineInCheckout = checkoutLineChecker(root);

  const outside = planAnnotations({ root: "dist", findings: [finding({ location: { file: "index.html", line: 9 } })], changed: new Set(["dist/index.html"]), lineInCheckout });
  assert.deepEqual(outside.annotations, []);
  assert.equal(outside.summarized[0]?.reason, "not-in-checkout");

  const inside = planAnnotations({ root: "dist", findings: [finding({ location: { file: "index.html", line: 4 } })], changed: new Set(["dist/index.html"]), lineInCheckout });
  assert.equal(inside.annotations.length, 1, "line 4 is a real line of the checked-out file");
  assert.equal(inside.summarized.length, 0);

  assert.ok(!lineInCheckout("dist/missing.html", 1), "a path that is not in the checkout is not annotated");
  assert.ok(!lineInCheckout("../escape.html", 1), "a path outside the workspace is not annotated");
  assert.ok(!lineInCheckout("C:/somewhere.html", 1), "an absolute-looking path is not annotated");

  assert.equal(lineCount(undefined), -1, "a file that is not there has no lines to point at");
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("one line"), 1);
  assert.equal(lineCount("one line\n"), 1, "a trailing newline does not add a line");
  assert.equal(lineCount("a\nb\nc"), 3);
  assert.equal(lineCount(readFileSync(join(root, "dist", "index.html"), "utf8")), 4);
  rmSync(root, { recursive: true, force: true });
});

test("an unreadable pull-request scope annotates nothing and does not blame the author", () => {
  const plan = planAnnotations({ root: "dist", findings: [finding({ severity: "error" })], changed: null, lineInCheckout: always });
  assert.deepEqual(plan.annotations, []);
  assert.equal(plan.summarized[0]?.reason, "unknown-changed");
  assert.match(SKIP_REASON_TEXT["unknown-changed"], /could not read which files/);
});

test("the annotation budget is explicit, errors first, and says what the rest were", () => {
  const findings = [...many(MAX_ANNOTATIONS + 5), finding({ severity: "warning", fingerprint: "warn-1" })];
  const changed = new Set(["dist/index.html"]);
  const plan = planAnnotations({ root: "dist", findings, changed, lineInCheckout: always });
  assert.equal(plan.annotations.length, MAX_ANNOTATIONS, "never 300 warnings on one pull request");
  assert.equal(plan.summarized.length, findings.length - MAX_ANNOTATIONS);
  assert.deepEqual(reasons(plan.summarized), Array.from({ length: 6 }, () => "over-cap"), "55 errors and 1 warning all fit the report; only the budget cuts them");
  assert.ok(plan.annotations.every((entry) => entry.finding.severity === "error"), "the budget goes to the errors first");

  const tight = planAnnotations({ root: "dist", findings: [finding({ severity: "note", fingerprint: "n" }), finding({ severity: "error", fingerprint: "e" })], changed, lineInCheckout: always, max: 1 });
  assert.deepEqual(tight.annotations.map((entry) => entry.finding.fingerprint), ["e"]);
  assert.equal(tight.summarized[0]?.reason, "over-cap");
  assert.match(SKIP_REASON_TEXT["over-cap"], /at most 50/);

  const section = summarySection(plan, { annotated: plan.annotations.length });
  assert.match(section, /^## Seaworthy inline annotations\n\n50 findings annotated inline; 6 findings reported here only\./);
  assert.match(section, /past the inline annotation budget/);
});

test("the summary channel lists at most SUMMARY_LIST_MAX findings and counts the rest", () => {
  const plan = planAnnotations({ root: "dist", findings: many(30, { location: { file: "index.html" } }), changed: null, lineInCheckout: always });
  const full = summarySection(plan, { annotated: 0 });
  assert.equal(full.split("\n").filter((line) => line.startsWith("- ")).length, 25, "25 listed, not 30");
  assert.match(full, /5 more findings in the same situation\./);
  assert.equal(summarySection({ annotations: [], summarized: [] }, { annotated: 0 }), "", "nothing to say, nothing written");

  const scopeMissing = planAnnotations({ root: "dist", findings: [finding({ severity: "error" })], changed: null, lineInCheckout: always });
  assert.match(
    summarySection(scopeMissing, { annotated: 0, unavailable: 'Neither "main" nor "origin/main" is in this checkout' }),
    /^## Seaworthy inline annotations\n\n0 findings annotated inline; 1 finding reported here only\.\n\nInline annotations need the files this pull request touched\. Neither "main" nor "origin\/main" is in this checkout\.\n\n- `dist\/index\.html:4` error `links\.internal`: Link to \/nope\.html points to a page that does not exist\. \(this run could not read which files/,
  );
});

// ---- the pull-request file list, from the checkout alone --------------------------------------------------------

test("a run that is not a pull request has no scope to read, and git is never called", () => {
  const calls: string[][] = [];
  const context = pullRequestContext({ GITHUB_BASE_REF: "  " }, process.cwd(), (args) => {
    calls.push([...args]);
    return "";
  });
  assert.equal(context.changed, null);
  assert.match(context.unavailable ?? "", /not a pull request/);
  assert.deepEqual(calls, []);
});

test("the base ref is tried as a local branch and as origin/<base>, and the diff is the three-dot range", () => {
  const calls: string[][] = [];
  const context = pullRequestContext({ GITHUB_BASE_REF: "main" }, "/repo", (args) => {
    calls.push([...args]);
    if (args[0] === "rev-parse" && args.at(-1) === "main^{commit}") throw new Error("not a valid object name 'main'");
    if (args[0] === "rev-parse") return "0123456789abcdef\n";
    return "dist/index.html\0dist/blog/post with space.html\0";
  });
  assert.deepEqual([...(context.changed ?? new Set())], ["dist/index.html", "dist/blog/post with space.html"]);
  assert.equal(context.unavailable, undefined);
  assert.deepEqual(calls.at(-1), ["diff", "--name-only", "-z", "--no-ext-diff", "origin/main...HEAD"]);
  assert.match(calls.at(-1)!.at(-1)!, /\.\.\.HEAD$/, "three dots: only what this head brings since it left the base");
});

test("a base ref missing from the checkout names the fix, and a hostile ref name never reaches git", () => {
  const calls: string[][] = [];
  const missing = pullRequestContext({ GITHUB_BASE_REF: "main" }, "/repo", (args) => {
    calls.push([...args]);
    throw new Error("not a valid object name 'main'");
  });
  assert.equal(missing.changed, null);
  assert.match(missing.unavailable ?? "", /fetch-depth: 0/);
  assert.equal(calls.filter((args) => args[0] === "diff").length, 0, "no diff against a ref that does not exist");

  const hostile = pullRequestContext({ GITHUB_BASE_REF: "--output=/tmp/pwned" }, "/repo", () => "");
  assert.equal(hostile.changed, null);
  assert.match(hostile.unavailable ?? "", /not something git can be handed safely/);

  const failing = pullRequestContext({ GITHUB_BASE_REF: "main" }, "/repo", (args) => {
    if (args[0] === "rev-parse") return "abc\n";
    throw new Error("git died");
  });
  assert.equal(failing.changed, null);
  assert.match(failing.unavailable ?? "", /git could not diff this checkout against "main": git died/);
});

// ---- the Action run itself, in a real throwaway repository ------------------------------------------------------

const made: string[] = [];
after(() => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A consumer's checkout: a built site, a config, and a git history whose base branch is `main`. */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "seaworthy-action-annotations-"));
  made.push(root);
  write(root, files);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

/** The pull-request head: a branch off `main` with its own commit, so `main...HEAD` names exactly these files. */
function headBranch(root: string, files: Record<string, string>, message: string): void {
  git(root, "checkout", "-q", "-b", "feature");
  write(root, files);
  git(root, "commit", "-q", "-am", message);
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

/** Every check off but the ones named, so a run holds findings of one known severity. */
function onlyChecks(...keep: string[]): string {
  const checks: Record<string, string> = {};
  for (const check of builtInChecks) if (!keep.includes(check.meta.id)) checks[check.meta.id] = "off";
  return JSON.stringify({ checks });
}

const OK_PAGE = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Page</title></head>\n<body><main><h1>Heading</h1><p>Text.</p></main></body></html>\n';
const NO_CHARSET_PAGE = '<!doctype html>\n<html lang="en"><head><title>Page</title></head>\n<body><main><h1>Heading</h1><p>Text.</p></main></body></html>\n';

async function run(root: string, env: Record<string, string | undefined>): Promise<{ code: number; stdout: string }> {
  let stdout = "";
  const forward = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await actionRun({ GITHUB_WORKSPACE: root, SEAWORTHY_SITE: "dist", ...env });
    return { code, stdout };
  } finally {
    process.stdout.write = forward;
  }
}

test("an error in a file the pull request touched becomes one inline annotation; its untouched neighbour does not", async () => {
  const root = repository({ "dist/index.html": OK_PAGE, "dist/other.html": NO_CHARSET_PAGE, "seaworthy.config.json": onlyChecks("html.charset") });
  headBranch(root, { "dist/index.html": NO_CHARSET_PAGE }, "head drops the charset declaration");
  const summary = join(root, "step-summary.md");

  const { code, stdout } = await run(root, { GITHUB_BASE_REF: "main", SEAWORTHY_THRESHOLD: "error", GITHUB_STEP_SUMMARY: summary });
  assert.equal(code, 1, "the CLI's verdict, unchanged by annotations");
  const annotated = stdout.match(/^::[a-z]+ file=[^\n]*$/gm) ?? [];
  assert.equal(annotated.length, 1, `exactly one annotation, saw:\n${stdout}`);
  assert.match(annotated[0] ?? "", /^::error file=dist\/index\.html,line=\d+(,col=\d+)?::html\.charset: /);
  assert.match(stdout, /1 annotated inline, 1 in the summary only/);

  const listed = readFileSync(summary, "utf8");
  assert.match(listed, /- `dist\/other\.html:\d+` error `html\.charset`/, "the untouched file is listed in the summary channel instead");
  assert.match(listed, /the pull request does not touch this file/);
});

test("annotations off, or a run outside a pull request, writes no annotation and keeps its exit code", async () => {
  const root = repository({ "dist/index.html": NO_CHARSET_PAGE, "seaworthy.config.json": onlyChecks("html.charset") });

  const off = await run(root, { GITHUB_BASE_REF: "main", SEAWORTHY_ANNOTATIONS: "off" });
  assert.equal(off.code, 1);
  assert.doesNotMatch(off.stdout, /^::/m, "the input turns the commands off");
  assert.doesNotMatch(off.stdout, /annotated inline/, "and does not report on them either");

  const pushed = await run(root, {});
  assert.equal(pushed.code, 1, "a push run's verdict is still the CLI's");
  assert.doesNotMatch(pushed.stdout, /^::/m, "there is no pull-request diff to annotate");
  assert.match(pushed.stdout, /no inline annotations \(this run is not a pull request\)/);

  const badInput = await run(root, { GITHUB_BASE_REF: "main", SEAWORTHY_ANNOTATIONS: "sometimes" }).catch((error: unknown) => error);
  assert.match(String(badInput), /annotations must be one of auto, off/);
});

test("threshold none still annotates, because annotating is not a verdict", async () => {
  const root = repository({ "dist/index.html": NO_CHARSET_PAGE, "seaworthy.config.json": onlyChecks("html.charset") });
  headBranch(root, { "dist/index.html": `${NO_CHARSET_PAGE}<p>edited</p>\n` }, "head edits the page again");

  const clean = await run(root, { GITHUB_BASE_REF: "main", SEAWORTHY_THRESHOLD: "none" });
  assert.equal(clean.code, 0, "the threshold says nothing fails");
  assert.match(clean.stdout, /^::error file=dist\/index\.html,line=\d+(,col=\d+)?::/m, "and the finding is still annotated");
});
