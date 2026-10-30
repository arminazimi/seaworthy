// layout.text-clipped: text its own box cuts off. The decision is made in Node from the numbers the
// browser measures, so the offline tests below feed those numbers in by hand and cover what must NOT
// be reported — text that fits, a box people can scroll, an ellipsis the author asked for, and the
// page itself, which layout.horizontal-overflow and layout.reflow own. The rendered tests only run
// when this machine has a browser to launch; without one, the probe skip is the contract.

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findBrowser } from "../src/browser.js";
import { runChecks, type RunResult } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { VIEWPORTS } from "../src/render.js";
import { addClip, type BoxMeasurement, clippedAxes, type MergedClip, minPixelsOf, layoutTextClipped } from "../src/checks/text-clipped.js";
import { EXIT, run } from "../src/cli.js";
import { makeSite } from "./helpers.js";

// packages/verify/dist/tests/text-clipped.test.js -> repository root is four levels up.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLEAN_FIXTURE = join(ROOT, "fixtures", "clean", "minimal", "site");

/** A measured box: wide text cut off by a 240 px box that hides what does not fit. */
const measurement = (overrides: Partial<BoxMeasurement> = {}): BoxMeasurement => ({
  selector: "body > main > div.card",
  snippet: '<div class="card" style="height:40px;overflow:hidden">',
  isPageBox: false,
  overflowX: "hidden",
  overflowY: "hidden",
  scrollWidth: 300,
  clientWidth: 240,
  scrollHeight: 120,
  clientHeight: 40,
  pastWidth: 60,
  pastHeight: 80,
  ellipsis: false,
  ...overrides,
});

const axesOf = (overrides: Partial<BoxMeasurement> = {}): string[] => clippedAxes(measurement(overrides), 3).map((clip) => `${clip.axis}:${clip.pixels}px:in ${clip.box}px`);

test("a box that hides its own text is reported on the axis that cuts it", () => {
  assert.deepEqual(axesOf(), ["horizontally:60px:in 240px", "vertically:80px:in 40px"], "both axes cut here, so both are named");
  assert.deepEqual(axesOf({ pastHeight: 0, scrollHeight: 40 }), ["horizontally:60px:in 240px"]);
  assert.deepEqual(clippedAxes(measurement({ pastHeight: 0, scrollHeight: 40 }), 3)[0], { axis: "horizontally", pixels: 60, box: 240, overflow: "hidden" });
  assert.deepEqual(axesOf({ pastWidth: 0, scrollWidth: 240 }), ["vertically:80px:in 40px"]);
});

test("text that fits is silent", () => {
  assert.deepEqual(axesOf({ pastWidth: 0, pastHeight: 0, scrollWidth: 240, scrollHeight: 40 }), []);
  // 2 px of a word outside the box is the rounding of a whole-pixel measurement, not a defect.
  assert.deepEqual(axesOf({ pastWidth: 2, scrollWidth: 242, pastHeight: 0, scrollHeight: 40 }), []);
});

test("a box whose overflow does not hide the excess is silent, however far its text reaches", () => {
  // The text spills, but people scroll or see it: nothing is cut off.
  for (const overflow of ["visible", "auto", "scroll", "overlay"]) {
    assert.deepEqual(axesOf({ overflowX: overflow, overflowY: overflow }), [], `${overflow} leaves the text reachable`);
  }
});

test("a truncation indicator the author asked for is a design choice, not a defect", () => {
  // text-overflow: ellipsis on a single line, or on a -webkit-line-clamp box: the browser draws the
  // "…", so the box truncates on purpose. The probe says so with `ellipsis`.
  assert.deepEqual(axesOf({ ellipsis: true }), []);
});

test("the page itself is not this check's finding", () => {
  // A page that scrolls sideways at a phone width, or that does not reflow at 320 CSS px, is
  // layout.horizontal-overflow's and layout.reflow's finding. This check reports the clipped element,
  // so html and body stay out of it even when their text reaches past the viewport.
  assert.deepEqual(axesOf({ isPageBox: true, selector: "html", scrollWidth: 1900, clientWidth: 375, pastWidth: 1525 }), []);
  assert.deepEqual(axesOf({ isPageBox: true, selector: "body", scrollHeight: 4000, clientHeight: 667, pastHeight: 3333 }), []);
});

test("minPixels decides how deep a cut is worth a finding", () => {
  assert.deepEqual(clippedAxes(measurement(), 200).map((clip) => clip.axis), [], "nothing is cut by 200 px here");
  assert.deepEqual(clippedAxes(measurement(), 50).map((clip) => clip.axis), ["horizontally", "vertically"]);
  assert.deepEqual(clippedAxes(measurement(), 61).map((clip) => clip.axis), ["vertically"], "the cut is 60 px of text, under the bar");
  assert.deepEqual(clippedAxes(measurement({ pastWidth: 2, scrollWidth: 250 }), 3).map((clip) => clip.axis), ["vertically"], "a box that spills by 10 px but whose text leaves only 2 px outside is not a cut worth a finding");
});

test("minPixelsOf falls back to the default on anything that is not a whole number of at least 0", () => {
  assert.equal(minPixelsOf({}), 3);
  assert.equal(minPixelsOf({ minPixels: 0 }), 0, "0 is a real request to report every cut the browser can see");
  assert.equal(minPixelsOf({ minPixels: 12 }), 12);
  for (const bad of [{ minPixels: -1 }, { minPixels: 2.5 }, { minPixels: "4" }, { minPixels: null }, { minPixels: NaN }]) {
    assert.equal(minPixelsOf(bad), 3, `${JSON.stringify(bad)} is not an option value`);
  }
});

test("the same box cut off at every width is one problem that names the widths", () => {
  const problems = new Map<string, MergedClip>();
  for (const [index, viewport] of VIEWPORTS.entries()) {
    for (const clip of clippedAxes(measurement({ pastHeight: 80 + index }), 3)) {
      addClip(problems, { file: "index.html", clip, selector: "main > .card", snippet: "<div>", viewport });
    }
  }
  const merged = [...problems.values()];
  assert.deepEqual(merged.map((clip) => clip.axis), ["horizontally", "vertically"], "one entry per axis, not per width");
  const vertical = merged[1]!;
  assert.deepEqual(vertical.widths.map((viewport) => viewport.name), ["phone", "tablet", "desktop"]);
  assert.equal(vertical.pixels, 82, "the finding keeps the deepest cut it was measured at");
});

test("the same box on two pages is two problems", () => {
  const problems = new Map<string, MergedClip>();
  for (const file of ["about.html", "index.html"]) {
    for (const clip of clippedAxes(measurement(), 3)) addClip(problems, { file, clip, selector: "main > .card", snippet: "<div>", viewport: VIEWPORTS[0]! });
  }
  assert.equal(problems.size, 4);
});

/** layout.text-clipped alone, with the browser opted in the way --rendered does. */
const checkWith = async (root: string, options: Readonly<Record<string, unknown>> = {}): Promise<RunResult> =>
  runChecks({ site: buildSite(root), checks: [layoutTextClipped], enable: { browser: true }, options: { "layout.text-clipped": options } });

const CLIPPED_CARD = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>card</title></head>\n<body><main><div class=\"card\" style=\"height:40px;overflow:hidden\"><p>" + "Lorem ipsum dolor sit amet, ".repeat(8) + "</p></div></main></body></html>\n";
const CLIPPED_BUTTON = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>button</title></head>\n<body><main><button style=\"width:70px;overflow:hidden;white-space:nowrap\">Submit your application now</button></main></body></html>\n";
const FITS = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>fits</title></head>\n<body><main><p>Nothing here is cut off: the box grows with the text.</p></main></body></html>\n";
// An ellipsis the author asked for, a region people scroll, and a picture cut by its thumbnail: all design choices.
const BY_DESIGN = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>by design</title></head>\n<body><main>" +
  '<p style="width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Submit your application now for a reply</p>' +
  '<div style="width:120px;height:40px;overflow:auto">' + "word ".repeat(200) + "</div>" +
  '<div style="width:100px;height:60px;overflow:hidden"><img src="big.png" alt="a wide picture" style="width:400px;height:300px;display:block"></div>' +
  "</main></body></html>\n";
// The page scrolls sideways and its own boxes hide nothing: layout.horizontal-overflow's finding.
const PAGE_SCROLLS = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>scrolls</title></head>\n<body><main>" +
  '<p style="width:900px">This paragraph is wider than a phone, so the page itself scrolls sideways. No box here hides its own text.</p>' +
  "</main></body></html>\n";

test("rendered: a fixed-height card and a narrow button are reported, and what is by design is not", async () => {
  if (findBrowser() === undefined) return; // no browser on this machine: the probe skips below, which is the contract
  const card = await checkWith(makeSite({ "index.html": CLIPPED_CARD }));
  assert.deepEqual(card.errors, []);
  assert.equal(card.findings.length, 1, "one clipped box is one finding, not one per width");
  const finding = card.findings[0]!;
  assert.equal(finding.checkId, "layout.text-clipped");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.location.file, "index.html");
  assert.match(finding.location.selector ?? "", /main > div/, "the clipped element is located by its selector");
  assert.match(finding.location.snippet ?? "", /class="card"/);
  assert.match(finding.message, /cuts its own text off vertically: \d+ CSS px of it sits outside the 40 px box, which hides the rest \(overflow-y: hidden\)\./);
  assert.match(finding.message, /Seen at phone \(375 px\), tablet \(768 px\), desktop \(1280 px\)\./);
  assert.match(finding.fix.summary, /min-height/);
  assert.equal(finding.fix.kind, "manual", "the fix belongs in a stylesheet the site builds from, so no edit is guessed");
  assert.deepEqual(finding.fix.edits, []);

  const button = await checkWith(makeSite({ "index.html": CLIPPED_BUTTON }));
  assert.equal(button.findings.length, 1);
  assert.match(button.findings[0]!.message, /cuts its own text off horizontally: \d+ CSS px of it sits outside the \d+ px box/);
  assert.match(button.findings[0]!.fix.summary, /overflow-x: auto/);

  for (const [name, page] of [["fits", FITS], ["by-design", BY_DESIGN], ["page-scrolls", PAGE_SCROLLS]] as const) {
    const result = await checkWith(makeSite({ "index.html": page }));
    assert.deepEqual(result.findings.map((f) => f.message), [], `${name}: nothing here is text cut off with no way to reach it`);
  }
});

test("rendered: minPixels raises the bar until the page is silent", async () => {
  if (findBrowser() === undefined) return;
  assert.ok((await checkWith(makeSite({ "index.html": CLIPPED_CARD }))).findings.length > 0);
  const quiet = await checkWith(makeSite({ "index.html": CLIPPED_CARD }), { minPixels: 4000 });
  assert.deepEqual(quiet.findings, [], "a cut shallower than minPixels is not reported");
});

test("a given browser path that is missing is a skip with a pointed hint, not a crash", async () => {
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": CLIPPED_CARD })), checks: [layoutTextClipped], enable: { browser: true }, browser: { path: "/no/such/browser/anywhere" } });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped.map((s) => [s.check, s.reason]), [["layout.text-clipped", "browser-unavailable"]]);
  assert.match(result.skipped[0]!.hint, /does not exist/);
});

test("the CLI wires --rendered and --browser-path in: layout.text-clipped is skipped when the path is missing", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--rendered", "--browser-path", "/no/such/browser/anywhere", "--format", "json"]);
  assert.equal(result.code, EXIT.ok, "a skip is not a failure");
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const clipped = report.skipped.find((s) => s.check === "layout.text-clipped");
  assert.ok(clipped, "layout.text-clipped is named under skipped");
  assert.equal(clipped!.reason, "browser-unavailable");
  assert.ok(clipped!.hint.length > 0);
});

test("layout.text-clipped is out of the default run: skipped with a hint, never silently passed", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--format", "json"]);
  assert.equal(result.code, EXIT.ok);
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string }[] };
  const clipped = report.skipped.find((s) => s.check === "layout.text-clipped");
  assert.ok(clipped, "layout.text-clipped is skipped without --rendered");
  assert.equal(clipped!.reason, "rendered-checks-disabled");
});
