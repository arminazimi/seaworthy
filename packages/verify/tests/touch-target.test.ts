// layout.target-size: rendered touch targets under the WCAG 2.5.8 24×24 CSS px minimum.
// The offline tests here stay offline: the merge tests are pure and the skip tests need no
// browser at all, and one of them pins the boundary with a11y.axe — axe's own target-size rule
// must stay switched off because this check owns it. The rendered tests only run when this
// machine has a browser to launch.

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findBrowser } from "../src/browser.js";
import { runChecks, type RunResult } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { a11yAxe, axeRuleOptions } from "../src/checks/a11y-axe.js";
import { layoutTargetSize, addTarget, type MeasuredTarget, type TargetProblem } from "../src/checks/touch-target.js";
import { VIEWPORTS } from "../src/render.js";
import { EXIT, run } from "../src/cli.js";
import { makeSite } from "./helpers.js";

// packages/verify/dist/tests/touch-target.test.js -> repository root is four levels up.
// The clean fixture is a site with zero findings, so the skip reporting has to come out of
// a report that would otherwise fail on its static findings.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLEAN_FIXTURE = join(ROOT, "fixtures", "clean", "minimal", "site");

// One 20×20 button: under the minimum at every width, and nothing else a target.
const SMALL = "<!doctype html>\n<html lang=\"en\"><head><title>small</title></head>\n<body><main><p>Buy below.</p>\n<button style=\"width: 20px; height: 20px; color: #000000\">Go</button></main></body></html>\n";
// Everything WCAG 2.5.8 or this check itself exempts: an inline link inside a sentence, a target
// of exactly 24×24, a disabled control, invisible elements, and a target positioned off screen.
const EXEMPT = "<!doctype html>\n<html lang=\"en\"><head><title>exempt</title></head>\n<body><main>\n<p style=\"color: #000000\">Read the <a href=\"/terms\" style=\"color: #333333\">terms and conditions</a> before you sign up to keep using the service.</p>\n<a href=\"/ok\" style=\"display: inline-block; width: 24px; height: 24px; color: #333333\">OK</a>\n<button disabled style=\"width: 20px; height: 20px; color: #000000\">No</button>\n<a href=\"/gone\" style=\"display: none\">Hidden</a>\n<a href=\"/shed\" style=\"visibility: hidden; display: inline-block; width: 20px; height: 20px\">Also hidden</a>\n<a href=\"/far\" style=\"position: absolute; left: -9999px; top: 0; display: inline-block; width: 20px; height: 20px\">Off screen</a>\n</main></body></html>\n";

const site = (page: string): string => makeSite({ "index.html": page });
/** layout.target-size alone, with the browser opted in like --rendered does. */
const checkWith = async (root: string): Promise<RunResult> =>
  runChecks({
    site: buildSite(root),
    checks: [layoutTargetSize],
    enable: { browser: true },
  });

const measured = (selector: string, width: number, height: number): MeasuredTarget => ({ selector, html: `<a href="/x">${selector}</a>`, width, height });

test("the same element under the minimum at every width is one problem naming the widths and the smallest box", () => {
  const problems = new Map<string, TargetProblem>();
  for (const viewport of VIEWPORTS) addTarget(problems, { file: "index.html", target: measured("main > a", 20, 20), viewport });
  assert.equal(problems.size, 1, "one problem is one finding, not one per width");
  addTarget(problems, { file: "index.html", target: measured("main > a", 23, 10), viewport: VIEWPORTS[0]! });
  const problem = [...problems.values()][0]!;
  assert.deepEqual(problem.widths.map((v) => v.name), ["phone", "tablet", "desktop", "phone"]);
  assert.equal(problem.width, 20);
  assert.equal(problem.height, 10, "the worst box across the widths is what a person taps");
});

test("targets on different pages or different elements are different problems", () => {
  const problems = new Map<string, TargetProblem>();
  addTarget(problems, { file: "index.html", target: measured("main > a", 20, 20), viewport: VIEWPORTS[0]! });
  addTarget(problems, { file: "about.html", target: measured("main > a", 20, 20), viewport: VIEWPORTS[0]! });
  addTarget(problems, { file: "index.html", target: measured("main > button", 20, 20), viewport: VIEWPORTS[0]! });
  assert.equal(problems.size, 3);
});

test("layout.target-size owns touch-target size: axe's target-size rule is switched off", () => {
  // The boundary with a11y.axe holds without a browser: one small target is never named twice.
  assert.deepEqual(axeRuleOptions().rules["target-size"], { enabled: false });
});

test("a given browser path that is missing is a skip with a pointed hint, not a crash", async () => {
  const result = await runChecks({
    site: buildSite(site(SMALL)),
    checks: [layoutTargetSize],
    enable: { browser: true },
    browser: { path: "/no/such/browser/anywhere" },
  });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped.map((s) => [s.check, s.reason]), [["layout.target-size", "browser-unavailable"]]);
  assert.ok(result.skipped.every((s) => /does not exist/.test(s.hint) && s.hint.length > 0));
});

test("a small target is one finding at every width, and nothing else on the page is reported", async () => {
  if (findBrowser() === undefined) return; // no browser on this machine: the probe skip above is the contract
  const result = await checkWith(site(SMALL));
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0]!;
  assert.equal(finding.checkId, "layout.target-size");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.location.file, "index.html");
  assert.ok(finding.location.selector !== undefined && finding.location.selector.endsWith("button"));
  assert.ok(finding.location.snippet !== undefined && finding.location.snippet.includes("button"));
  assert.match(finding.message, /20×20 CSS px/);
  assert.match(finding.message, /smaller than the 24×24 px minimum \(WCAG 2\.5\.8\)/);
  assert.match(finding.message, /Seen at phone \(375 px\), tablet \(768 px\), desktop \(1280 px\)\./, "the finding names the widths the problem was seen at");
  assert.match(finding.fix.summary, /WCAG 2\.5\.8/);
});

test("exempt and passing targets are never reported: inline-in-sentence, 24×24, disabled, invisible, off screen", async () => {
  if (findBrowser() === undefined) return;
  const result = await checkWith(site(EXEMPT));
  assert.deepEqual(result.findings.map((f) => f.message), []);
});

test("with a11y.axe alongside, only layout.target-size reports a small target", async () => {
  if (findBrowser() === undefined) return;
  const both = await runChecks({
    site: buildSite(site(SMALL)),
    checks: [layoutTargetSize, a11yAxe],
    enable: { browser: true },
  });
  assert.equal(both.findings.filter((f) => f.checkId === "layout.target-size").length, 1, "layout.target-size reports it");
  const fromAxe = both.findings.filter((f) => f.checkId === "a11y.axe" && f.message.includes("target-size"));
  assert.deepEqual(fromAxe, [], "a11y.axe stays silent on it");
});

test("the CLI wires --rendered and --browser-path in: layout.target-size is skipped when the path is missing", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--rendered", "--browser-path", "/no/such/browser/anywhere", "--format", "json"]);
  assert.equal(result.code, EXIT.ok, "a skip is not a failure");
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const target = report.skipped.find((s) => s.check === "layout.target-size");
  assert.ok(target, "layout.target-size is named under skipped");
  assert.equal(target!.reason, "browser-unavailable");
  assert.ok(target!.hint.length > 0);
});

test("layout.target-size is out of the default run: skipped with a hint, never silently passed", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--format", "json"]);
  assert.equal(result.code, EXIT.ok);
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string }[] };
  const target = report.skipped.find((s) => s.check === "layout.target-size");
  assert.ok(target, "layout.target-size is skipped without --rendered");
  assert.equal(target!.reason, "rendered-checks-disabled");
});
