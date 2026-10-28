// Unit tests for the `list_checks` tool result: pure serialization, no server process needed.
// Determinism is the contract: fixed key order, checks sorted by ID, byte-identical across runs.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CheckMeta } from "@seaworthy/verify";

import { listChecks } from "../src/list-checks.js";

const meta = (id: string, title = `Title for ${id}`): CheckMeta => ({
  id,
  title,
  severity: "error",
  needs: [],
  docs: `https://seaworthy.dev/checks/${id}/`,
  standards: [],
} as unknown as CheckMeta);

test("list_checks output is sorted by check id and carries the report spec version", () => {
  const output = JSON.parse(listChecks([meta("site.mixed-dash"), meta("a11y.tabindex"), meta("site.h1-count")])) as {
    spec: number;
    checks: Array<Record<string, unknown>>;
  };
  assert.deepEqual(output.checks.map((check) => check.id), ["a11y.tabindex", "site.h1-count", "site.mixed-dash"]);
  assert.deepEqual(Object.keys(output), ["spec", "checks"]);
  assert.deepEqual(
    Object.keys(output.checks[0]!),
    ["id", "title", "severity", "needs", "docs", "standards"],
    "field order is part of the deterministic output",
  );
});

test("list_checks output is byte-identical across calls and key orders", () => {
  const one = listChecks([meta("b.check"), meta("a.check"), meta("c.check")]);
  const two = listChecks([meta("c.check"), meta("a.check"), meta("b.check")]);
  assert.equal(one, two);
});
