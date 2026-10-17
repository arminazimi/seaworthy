import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { runChecks } from "../src/engine.js";
import { buildReport } from "../src/report.js";
import { buildSite } from "../src/site.js";
import type { Check, Report } from "../src/types.js";
import { makeSite } from "./helpers.js";

// packages/verify/dist/tests/schema.test.js -> repository root is four levels up.
const schemaPath = fileURLToPath(new URL("../../../../spec/report/v0.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const Ajv = Ajv2020 as unknown as typeof Ajv2020.default;
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);

const check: Check = {
  meta: { id: "images.alt", title: "Image has no alt attribute", severity: "error", needs: ["html"], docs: "https://example.test/images.alt", standards: ["WCAG 1.1.1"] },
  run: () => [
    {
      message: "<img> has no alt attribute.",
      location: { file: "index.html", line: 8, column: 1 },
      fix: { kind: "edit", summary: "Add alt text.", edits: [{ file: "index.html", line: 8, action: "replace", find: '<img src="/a.png">', replace: '<img src="/a.png" alt="">', needsInput: true }] },
      key: "/a.png",
    },
  ],
};

async function sampleReport(): Promise<Report> {
  const site = buildSite(makeSite({ "index.html": "<!doctype html><title>t</title>" }));
  const { findings, skipped, errors } = await runChecks({ site, checks: [check] });
  return buildReport({ root: "dist", pages: site.pages.size, checks: [check], findings, skipped, errors });
}

const errorsOf = (value: unknown) => (validate(value) ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`));

test("a real report from the engine validates against the schema", async () => {
  assert.deepEqual(errorsOf(await sampleReport()), []);
});

test("an empty report validates", () => {
  assert.deepEqual(errorsOf(buildReport({ root: ".", pages: 0, checks: [], findings: [] })), []);
});

test("the schema rejects reports that break the contract", async () => {
  const base = JSON.parse(JSON.stringify(await sampleReport()));
  const mutate = (change: (r: any) => void) => {
    const copy = JSON.parse(JSON.stringify(base));
    change(copy);
    return errorsOf(copy);
  };
  assert.notDeepEqual(mutate((r) => (r.spec = 1)), [], "wrong spec version");
  assert.notDeepEqual(mutate((r) => (r.root = "/abs/dist")), [], "absolute root");
  assert.notDeepEqual(mutate((r) => (r.findings[0].location.file = "C:\\site\\index.html")), [], "absolute or backslash file path");
  assert.notDeepEqual(mutate((r) => (r.findings[0].fingerprint = "xyz")), [], "bad fingerprint");
  assert.notDeepEqual(mutate((r) => (r.findings[0].severity = "critical")), [], "unknown severity");
  assert.notDeepEqual(mutate((r) => (r.findings[0].checkId = "Links")), [], "bad check ID");
  assert.notDeepEqual(mutate((r) => (r.findings[0].fix.appliesTo = "source")), [], "wrong appliesTo");
  assert.notDeepEqual(mutate((r) => (r.findings[0].fix.edits[0].action = "insert")), [], "unsupported edit action");
  assert.notDeepEqual(mutate((r) => (r.findings[0].extra = true)), [], "unknown property");
  assert.notDeepEqual(mutate((r) => delete r.findings[0].fix), [], "missing fix");
  assert.notDeepEqual(mutate((r) => (r.summary.bySeverity.error = 0)), [], "zero counts are omitted");
});
