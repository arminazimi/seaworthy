// layout.focus-visible: keyboard focus that shows nothing. The offline tests here decide the shapes the
// check refuses to judge and how one element seen at three widths becomes one finding; they need no browser.
// The measured tests drive a real browser and skip when this machine has none, because a rendered check is
// opt-in (ADR 0005) and its numbers only mean something in the browser that paints the ring.

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findBrowser } from "../src/browser.js";
import { runChecks, type RunResult } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { a11yAxe, axeRuleOptions } from "../src/checks/a11y-axe.js";
import { a11yHiddenFocusable } from "../src/checks/a11y.js";
import { addStop, layoutFocusVisible, skipReason, type StopElement, type UncoveredElement } from "../src/checks/focus-visible.js";
import { EXIT, run } from "../src/cli.js";
import { VIEWPORTS } from "../src/render.js";
import { makeSite } from "./helpers.js";

// packages/verify/dist/tests/focus-visible.test.js -> repository root is four levels up.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLEAN_FIXTURE = join(ROOT, "fixtures", "clean", "minimal", "site");

const page = (head: string, body: string): string => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>focus</title>${head}</head>\n<body><main><h1>Focus shapes</h1>${body}</main></body></html>\n`;
const style = (css: string): string => `<style>${css}</style>`;
const site = (html: string): string => makeSite({ "index.html": html });

/** One tab stop as the page would report it, with the facts this check decides on left at their plain defaults. */
const stop = (overrides: Partial<StopElement>): StopElement => ({
  tag: "A",
  selector: "html > body > main > a",
  snippet: '<a href="#x">a link</a>',
  name: "a link",
  shadowHost: false,
  hiddenFromAssistiveTech: false,
  animating: false,
  ...overrides,
});

/** layout.focus-visible alone, with the browser opted in the way --rendered does. */
const checkWith = async (root: string, browserPath?: string): Promise<RunResult> =>
  runChecks({
    site: buildSite(root),
    checks: [layoutFocusVisible],
    enable: { browser: true },
    ...(browserPath === undefined ? {} : { browser: { path: browserPath } }),
  });

test("layout.focus-visible is a rendered check: opt-in, offline, and documented", () => {
  const { id, severity, needs, standards, docs } = layoutFocusVisible.meta;
  assert.equal(id, "layout.focus-visible");
  assert.equal(severity, "error", "a keyboard user cannot see where they are: WCAG 2.4.7 is not a suggestion");
  assert.deepEqual(needs, ["html", "browser"]);
  assert.deepEqual(standards, ["WCAG 2.4.7"]);
  assert.ok(docs.endsWith("/docs/checks/layout.focus-visible.md"));
  assert.ok(layoutFocusVisible.probe !== undefined, "a browser-less machine gets a skip, not a pass");
});

test("shapes the browser cannot show are skipped rather than guessed", () => {
  // Only a script focuses this element, so Tab never puts a ring on it for a person to miss.
  assert.equal(skipReason(stop({ tabindex: "-1" })), "script-focused");
  assert.equal(skipReason(stop({ tabindex: "-2" })), "script-focused");
  // What a shadow root paints inside is not readable from the main document's styles.
  assert.equal(skipReason(stop({ tag: "MY-WIDGET", shadowHost: false })), "shadow-dom");
  assert.equal(skipReason(stop({ tag: "DIV", shadowHost: true })), "shadow-dom");
  // Focus reaching hidden content is a11y.hidden-focusable's finding, and one problem gets one finding.
  assert.equal(skipReason(stop({ hiddenFromAssistiveTech: true })), "hidden-from-assistive-tech");
  // An element on a loop repaints whether or not anything holds focus.
  assert.equal(skipReason(stop({ animating: true })), "self-animating");

  // Everything a person can actually reach by pressing Tab is judged, including a zero or absent tabindex.
  assert.equal(skipReason(stop({})), undefined);
  assert.equal(skipReason(stop({ tabindex: "0" })), undefined);
  assert.equal(skipReason(stop({ tabindex: "" })), undefined);
  assert.equal(skipReason(stop({ tabindex: "not a number" })), undefined);
});

test("the element is one finding, named at every width it was seen at", () => {
  const problems = new Map<string, UncoveredElement>();
  const element = stop({});
  for (const viewport of VIEWPORTS) addStop(problems, { file: "index.html", element, viewport, unchanged: true });
  assert.equal(problems.size, 1, "the same element at three widths is one problem");
  assert.deepEqual([...problems.values()][0]!.widths, VIEWPORTS, "the finding keeps the widths in the order they run");

  // A different page is a different element, even when the path through it reads the same.
  addStop(problems, { file: "de/index.html", element, viewport: VIEWPORTS[0]!, unchanged: true });
  assert.equal(problems.size, 2);
});

test("an element that looks different once focused is never a finding", () => {
  const problems = new Map<string, UncoveredElement>();
  addStop(problems, { file: "index.html", element: stop({}), viewport: VIEWPORTS[0]!, unchanged: false });
  assert.equal(problems.size, 0);
});

test("a11y.axe owns no rule for the focus indicator, and hidden focusable content stays with the static check", () => {
  const rules = axeRuleOptions().rules;
  // The table in a11y-axe.ts keeps this problem with a11y.hidden-focusable, which layout.focus-visible
  // also declines to judge, so the element inside aria-hidden is named once and not three times.
  assert.equal(rules["aria-hidden-focus"]?.enabled, false);
  assert.equal(skipReason(stop({ hiddenFromAssistiveTech: true })), "hidden-from-assistive-tech");
  // axe has no rule for a missing focus indicator at all: nothing here needs switching off for this check.
  assert.equal(rules["focus-order-semantics"], undefined, "focus-order-semantics is about roles, not appearance, and still runs");
});

test("a browser the machine does not have is a skip with a pointed hint, not a crash", async () => {
  const result = await checkWith(site(page(style("a:focus { outline: none }"), '<p><a href="#x">a link</a></p>')), "/no/such/browser/anywhere");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped.map((s) => [s.check, s.reason]), [["layout.focus-visible", "browser-unavailable"]]);
  assert.match(result.skipped[0]!.hint, /does not exist/);
});

test("the CLI wires --rendered and --browser-path in: the check is skipped when the path is missing", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--rendered", "--browser-path", "/no/such/browser/anywhere", "--format", "json"]);
  assert.equal(result.code, EXIT.ok, "a skip is not a failure");
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const focus = report.skipped.find((s) => s.check === "layout.focus-visible");
  assert.ok(focus, "layout.focus-visible is named under skipped");
  assert.equal(focus!.reason, "browser-unavailable");
});

test("layout.focus-visible is out of the default run: skipped with a hint, never silently passed", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--format", "json"]);
  assert.equal(result.code, EXIT.ok);
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string }[] };
  const focus = report.skipped.find((s) => s.check === "layout.focus-visible");
  assert.ok(focus, "layout.focus-visible is skipped without --rendered");
  assert.equal(focus!.reason, "rendered-checks-disabled");
});

// ---- measured in a browser, skipped when this machine has none -------------------------------------------

test("the browser's own ring counts, so an unstyled page reports nothing", async () => {
  if (findBrowser() === undefined) return;
  const html = page("", `
    <p><a href="#a">a link</a> <button>press me</button> <input type="text" aria-label="search">
    <select aria-label="pick"><option>one</option></select> <textarea aria-label="notes"></textarea></p>
    <details><summary>more</summary><p>inside</p></details>
    <p><span tabindex="0">a focusable note</span> <a href="#b">another link</a></p>`);
  assert.deepEqual((await checkWith(site(html))).findings, []);
});

test("an indicator counts whatever property carries it", async () => {
  if (findBrowser() === undefined) return;
  const html = page(
    style(`
      a, input { outline: none }
      .ring:focus-visible { outline: 3px solid rebeccapurple }
      .bg:focus-visible { background-color: #ffe600 }
      .shadow:focus-visible { box-shadow: 0 0 0 3px deeppink }
      .edge { border: 2px solid grey }
      .edge:focus-visible { border-color: #0066ff }
      .fade:focus-visible { outline: 3px solid #0066ff; transition: outline-color .25s }
      .ghost:focus-visible::after { content: ""; display: inline-block; width: 10px; height: 10px; background: #008000 }
      .wrap:focus-within { outline: 3px solid #008000 }
    `),
    `
    <p><a class="ring" href="#a">outline</a></p>
    <p><a class="bg" href="#b">background</a></p>
    <p><a class="shadow" href="#c">box shadow</a></p>
    <p><a class="edge" href="#d">border</a></p>
    <p><a class="fade" href="#e">fading in</a></p>
    <p><a class="ghost" href="#f">drawn by a pseudo-element</a></p>
    <p><label class="wrap" for="inner">Name <input id="inner" type="text"></label></p>`,
  );
  assert.deepEqual((await checkWith(site(html))).findings, [], "a changed appearance is a pass, whatever produced it");
});

test("outline removed with nothing in its place is one finding per element", async () => {
  if (findBrowser() === undefined) return;
  const html = page(style("a:focus { outline: none }"), `<p><a href="#a">first link</a></p>\n<p><a href="#b" style="outline: none">second link</a></p>`);
  const findings = (await checkWith(site(html))).findings;
  assert.equal(findings.length, 2);
  const [first, second] = findings;
  assert.equal(first!.checkId, "layout.focus-visible");
  assert.equal(first!.severity, "error");
  assert.equal(first!.location.file, "index.html");
  assert.equal(first!.location.selector, "html > body > main > p:nth-of-type(1) > a");
  assert.match(first!.location.snippet!, /first link/);
  assert.match(first!.message, /^<a> "first link" takes keyboard focus and nothing about it changes/);
  assert.match(first!.message, /Seen at phone \(375 px\), tablet \(768 px\), desktop \(1280 px\)\./);
  assert.match(first!.fix.summary, /:focus-visible/);
  assert.equal(first!.fix.kind, "manual");
  assert.equal(second!.location.selector, "html > body > main > p:nth-of-type(2) > a");
  assert.notEqual(first!.fingerprint, second!.fingerprint);
});

test("a focus style identical to the unfocused style is the same failure", async () => {
  if (findBrowser() === undefined) return;
  const html = page(
    style(`
      .same { outline: 1px solid black }
      .same:focus-visible { outline: 1px solid black }
      .ghost:focus-visible { outline: 3px solid transparent }
    `),
    `<p><a class="same" href="#a">border already there</a></p>\n<p><a class="ghost" href="#b">invisible ring</a></p>`,
  );
  const findings = (await checkWith(site(html))).findings;
  assert.deepEqual(findings.map((f) => f.location.selector), [
    "html > body > main > p:nth-of-type(1) > a",
    "html > body > main > p:nth-of-type(2) > a",
  ]);
});

test("an element a keyboard cannot reach is never reported", async () => {
  if (findBrowser() === undefined) return;
  // Nothing here takes a ring: the div is out of the tab order by its tabindex, the disabled input cannot
  // take focus at all, and a span, an <a> without href, or a heading is not focusable to begin with.
  const html = page(
    style("div, span, h2, input { outline: none }"),
    `<p><span>plain words</span> <a>no href</a> <label>a label</label></p>
     <h2>a heading</h2>
     <p><div tabindex="-1" style="outline: none">only a script focuses this</div></p>
     <input type="text" disabled aria-label="closed for edits">`,
  );
  assert.deepEqual((await checkWith(site(html))).findings, []);
});

test("a page whose CSS lives on a CDN is not judged: this run is offline", async () => {
  if (findBrowser() === undefined) return;
  // The local rule removes the ring and the remote file is the one that would have drawn the replacement.
  // Refused by the check itself, so measuring this page would report an indicator that really is there.
  const html = page(`<link rel="stylesheet" href="https://cdn.example.com/app.css">\n${style("a:focus { outline: none }")}`, '<p><a href="#a">a link</a></p>');
  assert.deepEqual((await checkWith(site(html))).findings, []);
});

test("an aria-hidden element that shows nothing is a11y.hidden-focusable's finding alone", async () => {
  if (findBrowser() === undefined) return;
  const html = page("", `<p><a href="#a">Reachable with a ring</a></p>\n<div aria-hidden="true"><p><a href="#b" style="outline: none">Hidden and ringless</a></p></div>`);
  const result = await runChecks({
    site: buildSite(site(html)),
    checks: [a11yHiddenFocusable, a11yAxe, layoutFocusVisible],
    enable: { browser: true },
  });
  assert.deepEqual(result.findings.map((f) => f.checkId), ["a11y.hidden-focusable"], "one problem, one finding");
});
