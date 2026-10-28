import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ActionInputError,
  formatSarifFromReportJson,
  parseInputs,
  ReportFormatError,
  sarifFromReportJson,
  THRESHOLDS,
  thresholdExitCode,
} from "../src/index.js";

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

test("parseInputs keeps the inputs as given and defaults site and sarif to disabled", () => {
  assert.deepEqual(parseInputs(env("error")), { site: "dist", threshold: "error", sarif: "out.sarif" });
  assert.deepEqual(parseInputs({ SEAWORTHY_SITE: "  dist  " }), { site: "dist", threshold: "error", sarif: "" });
  assert.deepEqual(parseInputs({}), { site: "", threshold: "error", sarif: "" });
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

test("the threshold exposes the CLI exit contract: 0, findings 1, crashed 4", () => {
  assert.equal(thresholdExitCode(CLEAN, "none"), 0);
  assert.equal(thresholdExitCode(CLEAN, "error"), 0);
  assert.equal(thresholdExitCode(BROKEN, "error"), 1);
  assert.equal(thresholdExitCode(BROKEN, "warning"), 1);
  assert.equal(thresholdExitCode(BROKEN, "none"), 0);
  assert.equal(thresholdExitCode(reportOf({ findings: [finding("note")] }), "warning"), 0);
  assert.equal(thresholdExitCode(reportOf({ errors: [{ check: "links.internal", message: "boom" }] }), "error"), 4);
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
