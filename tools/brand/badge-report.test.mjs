// Tests for the badge endpoint's pure function: report JSON in, badge state and SVG bytes out.
// Runs against the report shape `seaworthy verify --format json` writes (see spec/report).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { badgeForReport, badgeSvg, README_SNIPPET } from "./badge.mjs";
import { BRAND_DIR, markFragment, tokens } from "./mark.mjs";

const hex = (name) => tokens.colors[name].value;

/** A minimal verify report: only the fields the badge reads. */
function report({ error = 0, warning = 0, note = 0, checkErrors = 0 } = {}) {
  return {
    spec: 1,
    tool: { name: "seaworthy", version: "0.0.0" },
    root: "dist",
    summary: { pages: 1, findings: error + warning + note, bySeverity: { ...(error > 0 ? { error } : {}), ...(warning > 0 ? { warning } : {}), ...(note > 0 ? { note } : {}) } },
    checks: [],
    findings: [],
    suppressed: [],
    skipped: [],
    errors: Array.from({ length: checkErrors }, (_, i) => ({ check: `x.broken${i}`, message: "boom" })),
  };
}

test("a clean report — notes included — is teal passing", () => {
  for (const r of [report(), report({ note: 5 }), report({ note: 1, checkErrors: 0 })]) {
    const { state, count, svg } = badgeForReport(r);
    assert.equal(state, "passing");
    assert.equal(count, undefined);
    assert.ok(svg.includes(hex("seaTeal")), "right segment uses the passing color");
    assert.ok(!svg.includes(hex("signalAmber")) && !svg.includes(hex("alertRed")));
    assert.match(svg, /aria-label="seaworthy: passing"/);
  }
});

test("the color boundary is at count 0: one warning is amber, zero is not", () => {
  assert.equal(badgeForReport(report({ warning: 1 })).state, "warnings");
  assert.equal(badgeForReport(report({ warning: 2 })).state, "warnings");
  assert.equal(badgeForReport(report()).state, "passing");
  const { svg, count } = badgeForReport(report({ warning: 1 }));
  assert.equal(count, 1);
  assert.ok(svg.includes(hex("signalAmber")) && !svg.includes(hex("seaTeal")));
  assert.match(svg, /aria-label="seaworthy: 1 warning"/);
  assert.doesNotMatch(badgeForReport(report({ warning: 3 })).svg, /aria-label="seaworthy: 1 warning"/);
});

test("one error — including a crashed check — is red errors", () => {
  const { state, count, svg } = badgeForReport(report({ error: 1 }));
  assert.equal(state, "failing");
  assert.equal(count, 1);
  assert.ok(svg.includes(hex("alertRed")) && !svg.includes(hex("seaTeal")) && !svg.includes(hex("signalAmber")));
  assert.match(svg, /aria-label="seaworthy: 1 error"/);
  const crashed = badgeForReport(report({ checkErrors: 2 }));
  assert.equal(crashed.state, "failing");
  assert.equal(crashed.count, 2);
});

test("errors outweigh warnings, and the failing count is errors only", () => {
  const { state, count } = badgeForReport(report({ error: 12, warning: 30 }));
  assert.equal(state, "failing");
  assert.equal(count, 12);
});

test("generation is deterministic: byte-identical SVGs from the same report", () => {
  for (const r of [report(), report({ warning: 3 }), report({ error: 12 })]) {
    const first = badgeForReport(r);
    const second = badgeForReport(r);
    assert.equal(first.svg, second.svg);
    assert.equal(first.svg, badgeSvg(first.state, first.count), "state/count reconstruct the same bytes");
    const roundTrip = badgeForReport(JSON.parse(JSON.stringify(r)));
    assert.equal(roundTrip.svg, first.svg);
    assert.ok(first.svg.endsWith("\n"), "SVG ends with a newline");
  }
});

test("untrusted input is rejected with a message, never evaluated", () => {
  assert.throws(() => badgeForReport(null), /report must be the JSON object/);
  assert.throws(() => badgeForReport("[]"), /report must be the JSON object/);
  assert.throws(() => badgeForReport([]), /report must be the JSON object/);
  assert.throws(() => badgeForReport({}), /report\.summary must be an object/);
  assert.throws(() => badgeForReport({ summary: 3 }), /report\.summary must be an object/);
  assert.throws(() => badgeForReport({ summary: { bySeverity: 9 } }), /report\.summary\.bySeverity must be an object/);
  assert.throws(() => badgeForReport({ summary: { bySeverity: { error: "3" } } }), /bySeverity\.error must be a whole number/);
  assert.throws(() => badgeForReport({ summary: { bySeverity: { warning: -1 } } }), /bySeverity\.warning must be a whole number/);
  assert.throws(() => badgeForReport({ summary: { bySeverity: { note: 1.5 } } }), /bySeverity\.note must be a whole number/);
  assert.throws(() => badgeForReport({ summary: { bySeverity: {} }, errors: "no" }), /report\.errors must be an array/);
  // Malicious content is data, not code: it throws, it never runs.
  const poison = { summary: { bySeverity: { error: { run: () => "evil" } } } };
  assert.throws(() => badgeForReport(poison), /bySeverity\.error must be a whole number/);
});

test("the badge keeps its own copy of the mono mark in step with mark.mjs", () => {
  for (const state of ["passing", "warnings", "failing"]) {
    const svg = badgeSvg(state, state === "passing" ? undefined : 3);
    assert.ok(svg.includes(markFragment("mono")), "the badge must carry the same mono mark mark.mjs draws");
  }
});

test("the badge has one source: tools/brand/badge.mjs re-exports packages/action/src/badge-svg.ts", () => {
  const readme = readFileSync(join(BRAND_DIR, "..", "tools", "brand", "badge.mjs"), "utf8");
  assert.match(readme, /packages\/action\/dist\/src\/badge-svg\.js/, "badge.mjs must be a re-export, not a second implementation");
  assert.ok(!readme.includes("badgeSvg = "), "badge.mjs must not redefine the SVG function");
});

test("docs/badge.md carries the README snippet verbatim", () => {
  const doc = readFileSync(join(BRAND_DIR, "..", "docs", "badge.md"), "utf8");
  assert.ok(doc.includes(README_SNIPPET), "the README snippet must appear in docs/badge.md exactly as README_SNIPPET exports it");
});
