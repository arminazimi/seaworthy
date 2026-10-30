// layout.horizontal-overflow: rendered sideways scroll at phone width. The offline tests here stay
// offline: the pure decision runs on fabricated measurements and the skip tests need no browser at
// all. The rendered tests only run when this machine has a browser to launch, because pages must be
// laid out by a real engine to measure anything (rendered checks are opt-in, ADR 0005).

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findBrowser } from "../src/browser.js";
import { runChecks, type RunResult } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { horizontalOverflow, layoutHorizontalOverflow, type PageMeasurement } from "../src/checks/layout-overflow.js";
import { a11yAxe } from "../src/checks/a11y-axe.js";
import { EXIT, run } from "../src/cli.js";
import type { Viewport } from "../src/render.js";
import { makeSite } from "./helpers.js";

// packages/verify/dist/tests/layout-overflow.test.js -> repository root is four levels up.
// The clean fixture drives the CLI skip paths: a skip is reported, never a silent pass.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLEAN_FIXTURE = join(ROOT, "fixtures", "clean", "minimal", "site");

const PHONE: Viewport = { name: "phone", width: 375, height: 667 };
const measured = (over: Partial<PageMeasurement>): PageMeasurement => ({ scrollWidth: 375, clipsOverflow: false, ...over });

test("a document wider than the phone viewport is reported with its pan distance and culprit", () => {
  const finding = horizontalOverflow("index.html", measured({ scrollWidth: 420, culprit: { selector: "main > table", right: 420 } }), PHONE);
  assert.ok(finding);
  assert.match(finding.message, /^Page scrolls sideways on a phone: at phone \(375 px\) the document is 420 CSS px wide, so readers must pan 45 CSS px to reach the end\./);
  assert.ok(finding.message.includes("Widest element past the viewport: main > table."));
  assert.equal(finding.location.file, "index.html");
  assert.equal(finding.location.selector, "main > table");
  assert.equal(finding.fix.kind, "manual");
  assert.match(finding.fix.summary, /main > table/);
});

test("a page that fits the phone viewport is not reported", () => {
  assert.equal(horizontalOverflow("index.html", measured({}), PHONE), undefined);
  assert.equal(horizontalOverflow("index.html", measured({ scrollWidth: 374 }), PHONE), undefined);
  assert.equal(horizontalOverflow("index.html", measured({ scrollWidth: 375, culprit: { selector: "div", right: 375 } }), PHONE), undefined, "an element ending exactly at the edge reaches nothing past it");
});

test("a scroll without a named element still reports the pan", () => {
  const finding = horizontalOverflow("index.html", measured({ scrollWidth: 390 }), PHONE);
  assert.ok(finding);
  assert.ok(finding.message.includes("pan 15 CSS px"));
  assert.ok(!finding.message.includes("Widest element"), "no culprit measured, no culprit invented");
  assert.equal(finding.location.selector, undefined);
});

test("a page that hides its sideways overflow is reported as out of reach, not as fitting", () => {
  const finding = horizontalOverflow("blog/index.html", measured({ scrollWidth: 420, clipsOverflow: true, culprit: { selector: "#banner", right: 420 } }), PHONE);
  assert.ok(finding);
  assert.match(finding.message, /^Page content reaches 45 CSS px past the phone \(375 px\) viewport and no sideways scroll can bring it into view/);
  assert.match(finding.fix.summary, /overflow-x: hidden\/clip/);
});

test("content pinned past the edge with no document scroll at all is reported", () => {
  const finding = horizontalOverflow("index.html", measured({ culprit: { selector: "aside", right: 480 } }), PHONE);
  assert.ok(finding?.message.includes("105 CSS px past the phone (375 px) viewport"));
});

// ---- rendered checks --------------------------------------------------------------------------------------

const site = (page: string): string => makeSite({ "index.html": page });
/** layout.horizontal-overflow alone, with the browser opted in like --rendered does. */
const checkWith = async (root: string, browserPath?: string): Promise<RunResult> =>
  runChecks({
    site: buildSite(root),
    checks: [layoutHorizontalOverflow],
    enable: { browser: true },
    ...(browserPath === undefined ? {} : { browser: { path: browserPath } }),
  });

const CLEAN = "<!doctype html>\n<html lang=\"en\"><head><title>clean</title></head>\n<body><main><p>Short text that reflows at any phone width.</p></main></body></html>\n";
// A 500 CSS px block inside the default 8 px body margin: the document reaches 508 px at 375 px.
const OVERFLOWING = "<!doctype html>\n<html lang=\"en\"><head><title>overflow</title></head>\n<body><main><div id=\"wide\" style=\"width: 500px\">Wide content past the phone viewport.</div></main></body></html>\n";
// A wide table inside a region that itself fits and owns its sideways scroll: WCAG 1.4.10 allows
// two-dimensional scrolling inside a component, so the document itself must stay silent.
const CONTAINED = "<!doctype html>\n<html lang=\"en\"><head><title>contained</title></head>\n<body><main><section style=\"max-width: 100%; overflow-x: auto\"><table style=\"width: 600px\"><tbody><tr><td>Wide but panned inside its own region.</td></tr></tbody></table></section></main></body></html>\n";
// overflow-x: hidden does not reflow the page, it only removes the pan: the content is out of reach.
const CLIPPED = "<!doctype html>\n<html lang=\"en\"><head><title>clipped</title></head>\n<body style=\"overflow-x: hidden\"><main><div id=\"wide\" style=\"width: 500px\">Wide content the page hides.</div></main></body></html>\n";

test("a given browser path that is missing is a skip with a pointed hint, not a crash", async () => {
  const result = await checkWith(site(CLEAN), "/no/such/browser/anywhere");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped.map((s) => [s.check, s.reason]), [["layout.horizontal-overflow", "browser-unavailable"]]);
  assert.ok(result.skipped.every((s) => /does not exist/.test(s.hint) && s.hint.length > 0));
});

test("rendered: wide content is one finding, fitting content and contained regions are none", async () => {
  if (findBrowser() === undefined) return; // no browser on this machine: the probe skip above is the contract
  assert.deepEqual((await checkWith(site(CLEAN))).findings, []);
  assert.deepEqual((await checkWith(site(CONTAINED))).findings, [], "a region that pans itself does not make the document scroll");
  const overflowing = await checkWith(site(OVERFLOWING));
  assert.equal(overflowing.findings.length, 1);
  const finding = overflowing.findings[0]!;
  assert.equal(finding.checkId, "layout.horizontal-overflow");
  assert.equal(finding.severity, "error");
  assert.match(finding.message, /^Page scrolls sideways on a phone: at phone \(375 px\) the document is 508 CSS px wide, so readers must pan 133 CSS px/);
  assert.ok(finding.message.includes("Widest element past the viewport: #wide."));
  assert.equal(finding.location.file, "index.html");
  const clipped = await checkWith(site(CLIPPED));
  assert.equal(clipped.findings.length, 1, "hiding the sideways scroll is still a sideways overflow problem");
  assert.match(clipped.findings[0]!.message, /^Page content reaches \d+ CSS px past the phone \(375 px\) viewport and no sideways scroll/);
});

test("a11y.axe stays silent on a sideways-scrolling page: layout.horizontal-overflow owns it", async () => {
  if (findBrowser() === undefined) return;
  const root = site(OVERFLOWING);
  const overflow = await checkWith(root);
  assert.equal(overflow.findings.length, 1);
  // No axe-core rule decides the document's sideways scroll (checked against the bundled axe-core's
  // rule list), so the boundary is that a11y.axe must never report this problem either.
  const axe = await runChecks({ site: buildSite(root), checks: [a11yAxe], enable: { browser: true } });
  assert.deepEqual(axe.findings.map((f) => f.message), [], "one problem, one finding, under the layout check");
});

test("the CLI wires --rendered and --browser-path in: the check is skipped when the path is missing", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--rendered", "--browser-path", "/no/such/browser/anywhere", "--format", "json"]);
  assert.equal(result.code, EXIT.ok, "a skip is not a failure");
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const overflow = report.skipped.find((s) => s.check === "layout.horizontal-overflow");
  assert.ok(overflow, "layout.horizontal-overflow is named under skipped");
  assert.equal(overflow!.reason, "browser-unavailable");
  assert.ok(overflow!.hint.length > 0);
});

test("layout.horizontal-overflow is out of the default run: skipped with a hint, never silently passed", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--format", "json"]);
  assert.equal(result.code, EXIT.ok);
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const overflow = report.skipped.find((s) => s.check === "layout.horizontal-overflow");
  assert.ok(overflow, "layout.horizontal-overflow is skipped without --rendered");
  assert.equal(overflow!.reason, "rendered-checks-disabled");
});
