import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  ActionInputError,
  aggregateExit,
  formatSarifFromReportJson,
  parseInputs,
  ReportFormatError,
  sarifFromReportJson,
  sarifTargetFor,
  sarifTargets,
  THRESHOLDS,
} from "../src/index.js";
import { actionRun } from "../src/run.js";

// The SARIF 2.1.0 schema validation follows packages/verify/tests/helpers.ts: the official
// schema shipped by @microsoft/jest-sarif, validated with ajv 6 (the schema is draft-04).
const nodeRequire = createRequire(import.meta.url);
const sarifSchemaPath = join(dirname(nodeRequire.resolve("@microsoft/jest-sarif/package.json")), "lib", "schemas", "sarif-2.1.0-rtm.5.json");
const Ajv6Untyped = nodeRequire("ajv6") as unknown as new (options: Record<string, unknown>) => {
  addMetaSchema: (schema: unknown) => void;
  compile: (schema: unknown) => ((value: unknown) => boolean) & { errors: { instancePath: string; message?: string }[] | null };
};
const ajv6 = new Ajv6Untyped({ schemaId: "auto", allErrors: true, unknownFormats: "ignore" });
ajv6.addMetaSchema(nodeRequire("ajv6/lib/refs/json-schema-draft-04.json"));
const sarifValidator = ajv6.compile(JSON.parse(readFileSync(sarifSchemaPath, "utf8")));

/** Returns violations of the official SARIF 2.1.0 schema, or an empty list when the log conforms. */
function sarifErrors(value: unknown): string[] {
  return sarifValidator(value) ? [] : (sarifValidator.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

/** The report shape the Action reads, as `verify --format json` writes it. */
interface SampleFinding {
  checkId: string;
  severity: "error" | "warning" | "note";
  message: string;
  location: { file: string; line: number; column: number };
  fix: { kind: "manual"; summary: string; edits: []; appliesTo: "built-output" };
  fingerprint: string;
}

interface SampleReport {
  spec: number;
  tool: { name: "seaworthy"; version: string };
  root: string;
  summary: { pages: number; findings: number; suppressed: number; baselined: number; baselineStale: number };
  checks: { id: string; title: string; severity: "error" | "warning" | "note"; needs: string[]; docs: string; standards: string[] }[];
  findings: SampleFinding[];
  suppressed: unknown[];
  skipped: unknown[];
  errors: { check: string; message: string }[];
}

const CHECK = {
  id: "links.internal",
  title: "Internal links point at pages that exist.",
  severity: "error" as const,
  needs: ["html"],
  docs: "https://example.test/links.internal",
  standards: [],
};

function finding(severity: SampleFinding["severity"]): SampleFinding {
  return {
    checkId: "links.internal",
    severity,
    message: "Link to /nope.html points to a page that does not exist.",
    location: { file: "index.html", line: 4, column: 10 },
    fix: { kind: "manual", summary: "Point the link at /docs.html.", edits: [], appliesTo: "built-output" },
    fingerprint: "f1",
  };
}

function reportOf(over: Partial<SampleReport>): SampleReport {
  const findings = over.findings ?? [];
  return {
    spec: 0,
    tool: { name: "seaworthy", version: "0.1.0" },
    root: "dist",
    summary: { pages: 1, findings: findings.length, suppressed: 0, baselined: 0, baselineStale: 0 },
    checks: [CHECK],
    findings,
    suppressed: [],
    skipped: [],
    errors: [],
    ...over,
  };
}

const BROKEN = reportOf({ findings: [finding("error")] });
const CLEAN = reportOf({});

const env = (threshold: string | undefined): Record<string, string | undefined> => ({
  SEAWORTHY_THRESHOLD: threshold,
  SEAWORTHY_SITE: "dist",
  SEAWORTHY_SARIF: "out.sarif",
});

test("parseInputs keeps the inputs as given and defaults site, sarif, markdown and annotations", () => {
  assert.deepEqual(parseInputs(env("error")), { sites: ["dist"], threshold: "error", sarif: "out.sarif", markdown: [], annotations: "auto" });
  assert.deepEqual(parseInputs({ SEAWORTHY_SITE: "  dist  " }), { sites: ["dist"], threshold: "error", sarif: "", markdown: [], annotations: "auto" });
  assert.deepEqual(parseInputs({}), { sites: [], threshold: "error", sarif: "", markdown: [], annotations: "auto" });
});

test("parseInputs reads the annotations input, and only its documented values", () => {
  assert.equal(parseInputs({ SEAWORTHY_ANNOTATIONS: " OFF " }).annotations, "off");
  assert.equal(parseInputs({ SEAWORTHY_ANNOTATIONS: "Auto" }).annotations, "auto");
  assert.throws(() => parseInputs({ SEAWORTHY_ANNOTATIONS: "sometimes" }), (e: unknown) => {
    assert.ok(e instanceof ActionInputError);
    assert.match(e.message, /annotations must be one of auto, off/);
    return true;
  });
});

test("parseInputs reads the site input as one folder per line or comma", () => {
  assert.deepEqual(parseInputs({ SEAWORTHY_SITE: "dist, blog/_site\nwww/out\n" }).sites, ["dist", "blog/_site", "www/out"]);
  // Trailing separators and empty entries (a block scalar ends in a newline) cost nothing.
  assert.deepEqual(parseInputs({ SEAWORTHY_SITE: "dist,\n" }).sites, ["dist"]);
  assert.deepEqual(parseInputs({ SEAWORTHY_SITE: "dist,,blog" }).sites, ["dist", "blog"]);
  // Only newlines and commas separate: spaces inside a folder name survive.
  assert.deepEqual(parseInputs({ SEAWORTHY_SITE: "my site/dist, other" }).sites, ["my site/dist", "other"]);
});

test("parseInputs rejects a site that would leave the workspace", () => {
  // The Action verifies folders inside the repository workspace and nothing else.
  for (const site of ["/abs/dist", "../outside", "docs/../../escape", "C:\\site"]) {
    assert.throws(() => parseInputs({ SEAWORTHY_SITE: site }), ActionInputError, site);
  }
});

test("sarifTargets keeps the given path for one site and names one file per site for several", () => {
  // The single-site contract, byte for byte: also for the CLI's auto-discovered default (no site named).
  assert.deepEqual(sarifTargets(["dist"], "out.sarif"), ["out.sarif"]);
  assert.deepEqual(sarifTargets([], "out.sarif"), ["out.sarif"]);
  assert.deepEqual(sarifTargets(["dist"], ""), []);
  assert.deepEqual(sarifTargets(["dist", "blog/_site"], "out/seaworthy.sarif"), ["out/seaworthy.dist.sarif", "out/seaworthy.blog-_site.sarif"]);
  // No extension: the site label goes at the end. A dot inside a folder name is not an extension.
  assert.deepEqual(sarifTargetFor("www/out", "out.d/report"), "out.d/report.www-out");
  // Spaces and odd characters in a folder name become dashes, so the file name stays portable.
  assert.deepEqual(sarifTargetFor("my site/dist", "out.sarif"), "out.my-site-dist.sarif");
});

test("aggregateExit fails the run on any site, and a crash and a rejection stay themselves", () => {
  assert.equal(aggregateExit([0, 0]), 0);
  assert.equal(aggregateExit([0, 1, 0]), 1);
  assert.equal(aggregateExit([0, 4, 1]), 4, "a crashed site is reported as exit 4, not folded into the failed count");
  assert.equal(aggregateExit([4, 2, 1]), 2, "a rejected invocation outranks a crash");
});

test("parseInputs reads the markdown input as one path per line or comma", () => {
  assert.deepEqual(parseInputs({ SEAWORTHY_MARKDOWN: "README.md\ndocs/, skills/" }).markdown, ["README.md", "docs/", "skills/"]);
  // A block scalar in a workflow ends in a newline; it must not become an empty path.
  assert.deepEqual(parseInputs({ SEAWORTHY_MARKDOWN: "  README.md \n\n" }).markdown, ["README.md"]);
});

test("parseInputs accepts every threshold value, case-insensitively and trimmed", () => {
  for (const threshold of THRESHOLDS) {
    assert.equal(parseInputs(env(threshold)).threshold, threshold);
    assert.equal(parseInputs(env(threshold.toUpperCase())).threshold, threshold);
  }
});

test("parseInputs rejects an unknown threshold instead of silently defaulting", () => {
  assert.throws(() => parseInputs(env("fatal")), (e: unknown) => {
    assert.ok(e instanceof ActionInputError);
    assert.match(e.message, /threshold must be one of error, warning, note, none/);
    return true;
  });
});

test("the report JSON maps to a SARIF 2.1.0 log that passes the official schema", () => {
  const sarif = sarifFromReportJson(JSON.parse(JSON.stringify(BROKEN)));
  assert.deepEqual(sarifErrors(sarif), []);
  const run = (sarif as { runs: unknown[] }).runs[0] as { results: Record<string, unknown>[] };
  assert.equal(run.results.length, 1);
  const result = run.results[0] as unknown as {
    ruleId: string;
    level: string;
    locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number; startColumn: number } } }[];
  };
  assert.equal(result.ruleId, "links.internal");
  assert.equal(result.level, "error");
  assert.equal(result.locations[0]!.physicalLocation.artifactLocation.uri, "dist/index.html");
  assert.deepEqual(result.locations[0]!.physicalLocation.region, { startLine: 4, startColumn: 10 });
});

test("the SARIF text is JSON with a trailing newline, byte-stable across runs", () => {
  const first = formatSarifFromReportJson(BROKEN);
  assert.ok(first.endsWith("\n"));
  assert.deepEqual(JSON.parse(first), sarifFromReportJson(BROKEN));
  assert.equal(first, formatSarifFromReportJson(JSON.parse(JSON.stringify(BROKEN))));
});

test("sarifFromReportJson rejects input that is not a Seaworthy report", () => {
  assert.throws(() => sarifFromReportJson({ nope: true }), ReportFormatError);
  assert.throws(() => sarifFromReportJson(undefined), ReportFormatError);
});

// ---- the Action's own run ------------------------------------------------------------------------------------
// These tests run the built verify CLI, the way the composite action.yml does, so the exit contract
// is proven end to end: the `threshold` input has to decide the run's outcome, not the CLI's default.

const made: string[] = [];
after(() => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});

/** A consumer's checkout: a built site in dist/ and a config next to it. */
function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "seaworthy-action-"));
  made.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

const PAGE = "<!doctype html>\n<html lang=\"en\"><head><title>Page</title><meta name=\"description\" content=\"A description.\"></head>\n<body><main><h1>Heading</h1><p>Some text.</p></main></body></html>\n";

/** Turns off every check the page trips except the ones named, so the run has findings of a known severity only. */
function onlyChecks(...keep: string[]): string {
  const checks: Record<string, string> = {};
  for (const id of ["quality.not-found-page", "html.charset", "meta.canonical", "meta.viewport", "social.open-graph", "social.twitter-card", "readability.llms-txt"]) {
    if (!keep.includes(id)) checks[id] = "off";
  }
  return JSON.stringify({ checks });
}

/** Runs the Action against a workspace, with the run's own log lines captured. */
async function runAction(root: string, env: Record<string, string | undefined>): Promise<{ code: number; stdout: string }> {
  let stdout = "";
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await actionRun({ GITHUB_WORKSPACE: root, SEAWORTHY_SITE: "dist", ...env });
    return { code, stdout };
  } finally {
    process.stdout.write = write;
  }
}

test("the threshold input decides the exit code: a warning fails at warning, not at error", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": onlyChecks("meta.viewport") });
  assert.equal((await runAction(root, { SEAWORTHY_THRESHOLD: "warning" })).code, 1, "a warning is at the threshold");
  assert.equal((await runAction(root, { SEAWORTHY_THRESHOLD: "error" })).code, 0, "a warning is below the threshold");
  assert.equal((await runAction(root, { SEAWORTHY_THRESHOLD: "none" })).code, 0, "no threshold fails nothing");
});

test("an error fails the run at every threshold that includes it", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": onlyChecks("html.charset") });
  assert.equal((await runAction(root, { SEAWORTHY_THRESHOLD: "error" })).code, 1);
  assert.equal((await runAction(root, { SEAWORTHY_THRESHOLD: "warning" })).code, 1);
  assert.equal((await runAction(root, { SEAWORTHY_THRESHOLD: "note" })).code, 1);
  assert.equal((await runAction(root, { SEAWORTHY_THRESHOLD: "none" })).code, 0);
});

test("a failing site with SARIF enabled fails with the findings code and still writes the report", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": onlyChecks("html.charset") });
  const { code, stdout } = await runAction(root, { SEAWORTHY_THRESHOLD: "error", SEAWORTHY_SARIF: "out.sarif" });
  assert.equal(code, 1, "the site's findings fail the run, not the SARIF write");
  assert.match(stdout, /sarif written to out\.sarif/);
  const sarif = JSON.parse(readFileSync(join(root, "out.sarif"), "utf8")) as { runs: { results: { ruleId: string }[] }[] };
  assert.deepEqual(sarif.runs[0]!.results.map((r) => r.ruleId), ["html.charset"]);
});

test("a clean site passes and writes no SARIF when the input is empty", async () => {
  const root = workspace({ "dist/index.html": PAGE, "seaworthy.config.json": onlyChecks() });
  const { code } = await runAction(root, { SEAWORTHY_THRESHOLD: "error" });
  assert.equal(code, 0);
  assert.equal(existsSync(join(root, "out.sarif")), false);
});

test("the markdown input points the Markdown checks at sources outside the built folder", async () => {
  const root = workspace({
    "dist/index.html": PAGE,
    "seaworthy.config.json": onlyChecks(),
    "README.md": "# Readme\n\nRead [the guide](./docs/guide.md).\n",
  });
  const unwritten = await runAction(root, { SEAWORTHY_THRESHOLD: "error" });
  assert.equal(unwritten.code, 0, "without the input, README.md outside dist/ is not read");
  const verified = await runAction(root, { SEAWORTHY_THRESHOLD: "error", SEAWORTHY_MARKDOWN: "README.md" });
  assert.equal(verified.code, 1, "the missing link target in README.md is a finding of its own");
  assert.match(verified.stdout, /1 finding/, "exactly the Markdown finding, nothing else");
});

// ---- several sites in one repository (issue #262) -----------------------------------------------------------------
// Same setup as the single-site runs above: the built CLI verifies synthetic folders in a
// temp workspace. GOOD is a page that passes every check; PAGE trips html.charset (an error).

const GOOD = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Page</title><meta name=\"description\" content=\"A description.\"></head>\n<body><main><h1>Heading</h1><p>Some text.</p></main></body></html>\n";

/** Two sites under one config that leaves only html.charset switched on: site-a clean, site-b failing. */
function twoSites(): string {
  return workspace({
    "site-a/index.html": GOOD,
    "site-b/index.html": PAGE,
    "seaworthy.config.json": onlyChecks("html.charset"),
  });
}

test("one site's failure does not hide another's: every site is reported and the run fails", async () => {
  const { code, stdout } = await runAction(twoSites(), { SEAWORTHY_SITE: "site-a, site-b", SEAWORTHY_THRESHOLD: "error" });
  assert.equal(code, 1, "the run fails because one site failed at the threshold");
  assert.match(stdout, /seaworthy site-a: 0 findings in site-a/, "the clean site is reported too");
  assert.match(stdout, /seaworthy site-b: 1 finding in site-b/);
  assert.match(stdout, /2 sites verified, 1 failed at the threshold \(site-b: 1 finding\), overall exit 1/);
});

test("a site the CLI rejects (exit 2) still leaves the other sites verified, and stays exit 2", async () => {
  const { code, stdout } = await runAction(twoSites(), { SEAWORTHY_SITE: "no-such-folder, site-b", SEAWORTHY_THRESHOLD: "error" });
  assert.equal(code, 2, "the aggregate exits with the CLI's own usage code, not a folded 1");
  assert.match(stdout, /seaworthy no-such-folder: the CLI rejected this run \(exit 2\)/);
  assert.match(stdout, /seaworthy site-b: 1 finding in site-b/, "the other site's findings are still reported");
});

test("several sites write one SARIF file per site, named after the folder", async () => {
  const root = twoSites();
  const { code, stdout } = await runAction(root, { SEAWORTHY_SITE: "site-a, site-b", SEAWORTHY_THRESHOLD: "error", SEAWORTHY_SARIF: "out.sarif" });
  assert.equal(code, 1);
  assert.match(stdout, /sarif written to out.site-a.sarif/);
  assert.match(stdout, /sarif written to out.site-b.sarif/);
  const clean = JSON.parse(readFileSync(join(root, "out.site-a.sarif"), "utf8")) as { runs: { results: unknown[] }[] };
  const failing = JSON.parse(readFileSync(join(root, "out.site-b.sarif"), "utf8")) as { runs: { results: { ruleId: string }[] }[] };
  assert.deepEqual(clean.runs[0]!.results, [], "the clean site's report is its own file, not overwritten by the failing one");
  assert.deepEqual(failing.runs[0]!.results.map((r) => r.ruleId), ["html.charset"]);
});

test("a single site keeps the old contract exactly: the SARIF path as given, the log line as before", async () => {
  const root = twoSites();
  const { code, stdout } = await runAction(root, { SEAWORTHY_SITE: "site-b", SEAWORTHY_THRESHOLD: "error", SEAWORTHY_SARIF: "out.sarif" });
  assert.equal(code, 1);
  assert.match(stdout, /^seaworthy: 1 finding in site-b, 0 crashed checks; sarif written to out\.sarif\n/, "byte-identical to the pre-multi-site line");
  assert.equal(existsSync(join(root, "out.sarif")), true);
  assert.equal(existsSync(join(root, "out.site-b.sarif")), false, "one site never renames the file");
});

