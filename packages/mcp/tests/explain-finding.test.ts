// Unit tests for the `explain_finding` tool: what it returns for a known check and for a real
// finding shape, the errors it answers with, and that its JSON is deterministic. It reads only
// check metadata and this repository's docs pages — no site, no network, no server process.

import assert from "node:assert/strict";
import { test } from "node:test";

import { builtInChecks } from "@seaworthy/verify";
import type { Check, Edit } from "@seaworthy/verify";

import { explainFinding } from "../src/explain-finding.js";
import type { ExplainFindingOutput } from "../src/explain-finding.js";

const parse = (text: string): ExplainFindingOutput => JSON.parse(text) as ExplainFindingOutput;

/** A finding of the shape the report contract defines, as verify_site would have returned it. */
const finding = {
  checkId: "images.alt",
  severity: "warning" as const,
  message: "img /chart.png has no alt attribute.",
  location: { file: "index.html", line: 7, column: 3 },
  fix: {
    kind: "edit" as const,
    summary: "Add alt text that says what the image conveys.",
    edits: [{ file: "index.html", line: 7, action: "replace" as const, find: '<img src="/chart.png">', replace: '<img src="/chart.png" alt="Signups doubled">' }],
    appliesTo: "built-output" as const,
  },
  prompt: "Fix this Seaworthy finding. Check images.alt (warning) at index.html:7.",
};

test("explain_finding explains a known check id with hint, docs link, and before/after example", () => {
  const meta = builtInChecks.find((check) => check.meta.id === "images.alt")!.meta;
  const output = parse(explainFinding({ check_id: "images.alt" }));
  assert.deepEqual(Object.keys(output), ["checkId", "title", "severity", "needs", "standards", "docs", "fixHint", "edits", "example"], "field order is part of the deterministic output");
  assert.equal(output.checkId, "images.alt");
  assert.equal(output.title, meta.title);
  assert.equal(output.severity, meta.severity, "without a finding the check's default severity is the answer");
  assert.deepEqual(output.needs, meta.needs);
  assert.deepEqual(output.standards, meta.standards);
  assert.equal(output.docs, `https://github.com/arminazimi/seaworthy/blob/main/docs/checks/images.alt.md`, "the docs URL is verify's own, never re-invented here");
  assert.match(output.fixHint, /alt/, "the docs page's fix guidance carries the hint");
  assert.match(output.example, /<img[^>]*alt=/, "the example is the check contract's before/after code");
  assert.deepEqual(output.edits, []);
  assert.equal("prompt" in output, false, "no finding, no prompt");
});

test("explain_finding returns the finding's own fix hint, edits, and prompt verbatim", () => {
  const output = parse(explainFinding({ finding }));
  assert.equal(output.checkId, "images.alt");
  assert.equal(output.severity, "warning", "the finding's severity overrides the check default");
  assert.equal(output.fixHint, finding.fix.summary);
  assert.deepEqual(output.edits, finding.fix.edits);
  assert.equal(output.prompt, finding.prompt);
});

test("explain_finding answers a check id it does not know with an error, never an invention", () => {
  assert.throws(() => explainFinding({ check_id: "no.such.check" }), /unknown check id "no\.such\.check".*list_checks lists them/);
  // The id never reaches the filesystem before the registry lookup, so traversal is just unknown.
  assert.throws(() => explainFinding({ check_id: "../../secret" }), /unknown check id/);
});

test("explain_finding needs one of check_id and finding, and the two must agree", () => {
  assert.throws(() => explainFinding({}), /needs a check_id or a finding/);
  assert.throws(() => explainFinding({ check_id: "meta.lang", finding }), /does not match the finding's check/);
});

test("explain_finding output is byte-identical across calls", () => {
  assert.equal(explainFinding({ check_id: "md.links" }), explainFinding({ check_id: "md.links" }));
  assert.equal(explainFinding({ finding }), explainFinding({ finding }));
});

test("explain_finding degrades to the docs URL when this install ships no docs pages", () => {
  const meta = builtInChecks.find((check) => check.meta.id === "images.alt")!.meta;
  const output = parse(explainFinding({ check_id: "images.alt" }, { docsDir: "/nonexistent/seaworthy-docs" }));
  assert.equal(output.fixHint, `See ${meta.docs}`);
  assert.equal(output.example, "");
});

test("every built-in check answers explain_finding with a hint and its published docs URL", () => {
  // The registry is the contract: each check id explains from its own metadata and docs page.
  const docsOf = (id: string): string => `https://github.com/arminazimi/seaworthy/blob/main/docs/checks/${id}.md`;
  for (const check of [...builtInChecks].sort((a, b) => (a.meta.id < b.meta.id ? -1 : 1))) {
    const output = parse(explainFinding({ check_id: check.meta.id }));
    assert.equal(output.docs, docsOf(check.meta.id), `${check.meta.id} docs URL is constructed from its id`);
    assert.ok(output.fixHint.length > 0, `${check.meta.id} explains with a hint`);
  }
});

test("explain_finding reads metadata from the injected checks, like every other tool", () => {
  const custom: Check = {
    meta: { id: "custom.rule", title: "A custom rule", severity: "note", needs: ["html"], docs: "https://example.test/docs/custom.rule.md", standards: ["WCAG 1.1.1"] },
    run: () => [],
  };
  const output = parse(explainFinding({ check_id: "custom.rule" }, { checks: [custom] }));
  assert.equal(output.title, "A custom rule");
  assert.equal(output.severity, "note");
  assert.deepEqual(output.standards, ["WCAG 1.1.1"]);
  assert.equal(output.docs, "https://example.test/docs/custom.rule.md");
  assert.equal(output.fixHint, "See https://example.test/docs/custom.rule.md", "no docs page for a custom check: the hint points at its own docs URL");
  const edits: Edit[] = [{ file: "a.html", line: 1, action: "replace", find: "x", replace: "y" }];
  const withFinding = parse(explainFinding({ finding: { checkId: "custom.rule", fix: { kind: "edit", summary: "fix it", edits } }, }, { checks: [custom] }));
  assert.deepEqual(withFinding.edits, edits);
});
