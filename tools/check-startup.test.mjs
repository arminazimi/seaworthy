import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET_MS, verdict } from "./check-startup.mjs";

test("the gate judges the best run, not the mean or a single outlier", () => {
  const { best, ok } = verdict([80, 95, 300, 120, 90], BUDGET_MS);
  assert.equal(best, 80);
  assert.ok(ok, "one outlier must not fail a fast CLI");
});

test("the boundary is inclusive: a run at exactly the budget passes", () => {
  assert.ok(verdict([BUDGET_MS], BUDGET_MS).ok);
  assert.ok(!verdict([BUDGET_MS + 1], BUDGET_MS).ok);
});

test("on a throttled host, a CLI explained by the bare-Node floor still passes", () => {
  // The absolute number is over budget, but bare Node alone uses almost all of it.
  const { ok } = verdict([130, 128], BUDGET_MS, 90);
  assert.ok(ok, "overhead 40 ms is within half the budget");
});

test("on a throttled host, a genuinely slower CLI still fails", () => {
  const { ok, overhead } = verdict([280, 275], BUDGET_MS, 90);
  assert.equal(overhead, 185);
  assert.ok(!ok, "185 ms overhead far exceeds half the budget");
});

test("without a floor, over-budget always fails", () => {
  const { ok } = verdict([200], BUDGET_MS);
  assert.ok(!ok);
});

test("the default budget is the 150 ms that ADR 0004 fixes", () => {
  assert.equal(BUDGET_MS, 150);
});
