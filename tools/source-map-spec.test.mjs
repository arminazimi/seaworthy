// spec/source-map/v0.md is a prose contract, so it needs the guard its schema-based siblings get
// from `npm run schema:build`: every JSON example printed in the document must satisfy the rules
// the document states, and the rules the document states must actually reject the inputs it says a
// consumer refuses. If a field's rule drifts from the worked examples, this fails.
//
// The validator below is the contract as written in v0.md, transcribed as a test. It is NOT shipped
// product code — Seaworthy reads no source-map file today (see the spec's "What Seaworthy does
// today") — so it lives here, next to the spec it checks, rather than under packages/verify/src.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = join(ROOT, "spec", "source-map", "v0.md");

/** True for a path that stays inside its root and uses the forward-slash form the spec requires:
 * no backslash, no leading "/", no drive letter, and no "." or ".." segment. */
function isContainedPath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\\")) return false;
  if (/^([a-zA-Z]:)?\//.test(value)) return false; // absolute or drive-rooted
  return !value.split("/").some((segment) => segment === "." || segment === "..");
}

/** Returns the list of rule violations for one entry, mirroring the Fields and Conformance tables. */
function entryProblems(entry, index) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return [`entry ${index}: must be an object`];
  }
  const problems = [];
  if (!isContainedPath(entry.target)) problems.push(`entry ${index}: target must be a root-contained, forward-slash path`);
  if (!isContainedPath(entry.source)) problems.push(`entry ${index}: source must be a root-contained, forward-slash path`);
  if (!Number.isInteger(entry.line) || entry.line < 1) problems.push(`entry ${index}: line must be an integer >= 1`);
  if (entry.column !== undefined && (!Number.isInteger(entry.column) || entry.column < 1)) {
    problems.push(`entry ${index}: column, when present, must be an integer >= 1`);
  }
  if (entry.anchor !== undefined && (typeof entry.anchor !== "string" || entry.anchor.length === 0 || entry.anchor.includes("#"))) {
    problems.push(`entry ${index}: anchor, when present, must be a non-empty fragment without the leading #`);
  }
  return problems;
}

/** Validates a whole source-map document against the v0 rules. Unknown members are ignored on
 * purpose (forward compatibility), so they are not reported as problems. */
function validateSourceMap(doc) {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return ["top level must be a JSON object"];
  const problems = [];
  if (!Number.isInteger(doc.spec) || doc.spec < 0) problems.push("spec must be a non-negative integer");
  if (!Array.isArray(doc.entries)) problems.push("entries must be an array");
  else doc.entries.forEach((entry, index) => problems.push(...entryProblems(entry, index)));
  return problems;
}

/** Pulls every ```json fenced block out of the spec document, in order. */
function jsonExamples(markdown) {
  const blocks = [];
  const fence = /```json\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(fence)) blocks.push(match[1]);
  return blocks;
}

const spec = readFileSync(SPEC_PATH, "utf8");
const examples = jsonExamples(spec);

test("the source-map spec contains at least one worked JSON example", () => {
  assert.ok(examples.length >= 2, "expected the full example and a minimal example");
});

test("every JSON example in spec/source-map/v0.md satisfies the rules the spec states", () => {
  for (const [index, text] of examples.entries()) {
    let doc;
    assert.doesNotThrow(() => {
      doc = JSON.parse(text);
    }, `example ${index} must be valid JSON`);
    assert.deepEqual(validateSourceMap(doc), [], `example ${index} violates its own contract`);
  }
});

test("the validator refuses the inputs the failure table says a consumer must reject", () => {
  const ok = { spec: 0, entries: [{ target: "a.html", source: "src/a.md", line: 1 }] };
  assert.deepEqual(validateSourceMap(ok), [], "a minimal conforming file passes");

  const cases = [
    ["missing spec", { entries: [] }],
    ["non-integer spec", { spec: "0", entries: [] }],
    ["entries not an array", { spec: 0, entries: {} }],
    ["absolute source", { spec: 0, entries: [{ target: "a.html", source: "/etc/passwd", line: 1 }] }],
    ["drive-letter source", { spec: 0, entries: [{ target: "a.html", source: "C:/Windows/x", line: 1 }] }],
    ["source escapes root", { spec: 0, entries: [{ target: "a.html", source: "../../secret.md", line: 1 }] }],
    ["backslash in target", { spec: 0, entries: [{ target: "a\\b.html", source: "src/a.md", line: 1 }] }],
    ["line out of range", { spec: 0, entries: [{ target: "a.html", source: "src/a.md", line: 0 }] }],
    ["anchor carries a hash", { spec: 0, entries: [{ target: "a.html", source: "src/a.md", line: 1, anchor: "#top" }] }],
    ["missing required target", { spec: 0, entries: [{ source: "src/a.md", line: 1 }] }],
  ];
  for (const [label, doc] of cases) {
    assert.ok(validateSourceMap(doc).length > 0, `${label} must be reported as a problem`);
  }
});

test("unknown members are ignored, so a newer file still reads", () => {
  const future = {
    spec: 0,
    entries: [{ target: "a.html", source: "src/a.md", line: 1, kind: "page" }],
    generatedBy: "some-generator",
    revision: 7,
  };
  assert.deepEqual(validateSourceMap(future), [], "unread fields must not fail a conforming reader");
});

test("the spec keeps the rules this guard depends on, and does not claim a consumer", () => {
  assert.ok(spec.includes("# Source-map spec, v0"), "the title anchors the contract");
  assert.ok(spec.includes("source-map.json"), "the file is named");
  assert.ok(spec.includes("sourcemaps.info/spec.html"), "the relationship to Source Map v3 is stated");
  assert.match(spec, /path traversal/i, "the traversal rule is present");
  assert.ok(
    spec.includes('grep -rn "source-map\\|sourceMap" packages/verify/src'),
    "the spec records, verbatim, the grep that proves no consumer ships",
  );
});
