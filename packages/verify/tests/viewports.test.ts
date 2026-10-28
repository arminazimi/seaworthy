// The widths every rendered check measures at, and how one problem is kept one problem when it is
// seen at several of them. The rendered tests themselves live in a11y-axe.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

import { addViolation, type AxeViolation, type MergedViolation } from "../src/checks/a11y-axe.js";
import { VIEWPORTS, viewportLabel } from "../src/render.js";

const axe = (id: string, impact: string | null): AxeViolation => ({ id, impact, help: `help for ${id}`, failureSummary: null, nodes: [] });

test("the widths are phone, tablet, and desktop, narrowest first", () => {
  assert.deepEqual(VIEWPORTS.map((viewport) => viewport.name), ["phone", "tablet", "desktop"]);
  assert.ok(VIEWPORTS[0]!.width < VIEWPORTS[1]!.width);
  assert.ok(VIEWPORTS[1]!.width < VIEWPORTS[2]!.width);
});

test("a finding names the widths it was seen at", () => {
  assert.equal(viewportLabel([VIEWPORTS[0]!]), "phone (375 px)");
  assert.equal(viewportLabel(VIEWPORTS), "phone (375 px), tablet (768 px), desktop (1280 px)");
});

test("the same rule on the same element at every width is one problem that names the widths", () => {
  const problems = new Map<string, MergedViolation>();
  for (const viewport of VIEWPORTS) {
    addViolation(problems, { file: "index.html", violation: axe("color-contrast", "serious"), selector: "main > p", snippet: "<p>", viewport });
  }
  assert.equal(problems.size, 1, "one problem is one finding, not one per width");
  const problem = [...problems.values()][0]!;
  assert.deepEqual(problem.widths.map((viewport) => viewport.name), ["phone", "tablet", "desktop"]);
  assert.equal(problem.severity, "error");
  assert.equal(problem.file, "index.html");
  assert.equal(problem.selector, "main > p");
});

test("a problem seen at one width only names that width", () => {
  const problems = new Map<string, MergedViolation>();
  addViolation(problems, { file: "index.html", violation: axe("target-size", "serious"), selector: "button", snippet: undefined, viewport: VIEWPORTS[0]! });
  const problem = [...problems.values()][0]!;
  assert.deepEqual(problem.widths.map((viewport) => viewport.name), ["phone"]);
});

test("a problem keeps the worst severity it had at any width", () => {
  const problems = new Map<string, MergedViolation>();
  addViolation(problems, { file: "index.html", violation: axe("color-contrast", "minor"), selector: "p", snippet: undefined, viewport: VIEWPORTS[0]! });
  addViolation(problems, { file: "index.html", violation: axe("color-contrast", "critical"), selector: "p", snippet: undefined, viewport: VIEWPORTS[1]! });
  const problem = [...problems.values()][0]!;
  assert.equal(problem.severity, "error");
  assert.equal(problem.widths.length, 2);
});

test("the same rule and selector on two pages are two problems", () => {
  const problems = new Map<string, MergedViolation>();
  addViolation(problems, { file: "index.html", violation: axe("color-contrast", "serious"), selector: "p", snippet: undefined, viewport: VIEWPORTS[0]! });
  addViolation(problems, { file: "about.html", violation: axe("color-contrast", "serious"), selector: "p", snippet: undefined, viewport: VIEWPORTS[0]! });
  assert.equal(problems.size, 2);
});
