// a11y.axe: rendered accessibility with axe-core. The offline tests here stay offline:
// pages load from file:// URLs inside the check, remote requests are aborted by the check
// itself, and the skip tests need no browser at all. The rendered tests keep the fixture
// gate offline (rendered checks are opt-in, ADR 0005) and only run when this machine has
// a browser to launch.

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findBrowser } from "../src/browser.js";
import { runChecks, type RunResult } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { a11yAxe } from "../src/checks/a11y-axe.js";
import { builtInChecks } from "../src/checks/index.js";
import { EXIT, run } from "../src/cli.js";
import { makeSite } from "./helpers.js";

// packages/verify/dist/tests/a11y-axe.test.js -> repository root is four levels up.
// The clean fixture is a site with zero findings: rendered skip reporting has to come out
// of a report that would otherwise fail on its static findings.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLEAN_FIXTURE = join(ROOT, "fixtures", "clean", "minimal", "site");

const CLEAN = "<!doctype html>\n<html lang=\"en\"><head><title>clean</title></head>\n<body><main><p>Enough text for axe to decide.</p></main></body></html>\n";
// #999 on the default white background is about 2.85:1, under the 4.5:1 minimum: a real,
// layout-dependent failure only a rendered engine can decide.
const BROKEN = "<!doctype html>\n<html lang=\"en\"><head><title>broken</title></head>\n<body><main><p style=\"color: #999999\">Text that fails contrast against white.</p></main></body></html>\n";
// image-alt is reported by images.alt, so a11y.axe must stay silent to keep one problem one finding.
const STATICALLY_COVERED = "<!doctype html>\n<html lang=\"en\"><head><title>covered</title></head>\n<body><main><img src=\"x.png\" alt=\"\"></main></body></html>\n";

const site = (page: string): string => makeSite({ "index.html": page });
/** a11y.axe alone, with the browser opted in like --rendered does. */
const checkWith = async (root: string, browserPath?: string): Promise<RunResult> =>
  runChecks({
    site: buildSite(root),
    checks: [a11yAxe],
    enable: { browser: true },
    ...(browserPath === undefined ? {} : { browser: { path: browserPath } }),
  });

test("a given browser path that is missing is a skip with a pointed hint, not a crash", async () => {
  const result = await checkWith(site(CLEAN), "/no/such/browser/anywhere");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped.map((s) => [s.check, s.reason]), [["a11y.axe", "browser-unavailable"]]);
  assert.ok(result.skipped.every((s) => /does not exist/.test(s.hint) && s.hint.length > 0));
});

test("after the probe passes, a clean page is silent and a contrast failure is one finding", async () => {
  if (findBrowser() === undefined) return; // no browser on this machine: the probe skip above is the contract
  assert.deepEqual((await checkWith(site(CLEAN))).findings, []);
  const broken = await checkWith(site(BROKEN));
  assert.equal(broken.findings.length, 1);
  const contrast = broken.findings[0]!;
  assert.match(contrast.message, /^axe color-contrast: /);
  assert.equal(contrast.severity, "error", 'axe impact "serious" maps to error');
  assert.equal(contrast.location.file, "index.html");
  assert.ok(contrast.location.selector !== undefined && contrast.location.selector.length > 0);
  assert.ok(contrast.location.snippet !== undefined && contrast.location.snippet.includes("color"));
  assert.match(contrast.fix.summary, /axe rule "color-contrast"/);
});

test("rules the static checks report are switched off in axe", async () => {
  if (findBrowser() === undefined) return;
  const withoutAlt = await checkWith(site(STATICALLY_COVERED));
  const altFindings = withoutAlt.findings.filter((f) => f.message.startsWith("axe image-alt"));
  assert.deepEqual(altFindings, []);
});

test("the CLI wires --rendered and --browser-path in: a11y.axe is skipped when the path is missing", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--rendered", "--browser-path", "/no/such/browser/anywhere", "--format", "json"]);
  assert.equal(result.code, EXIT.ok, "a skip is not a failure");
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const axe = report.skipped.find((s) => s.check === "a11y.axe");
  assert.ok(axe, "a11y.axe is named under skipped");
  assert.equal(axe!.reason, "browser-unavailable");
  assert.ok(axe!.hint.length > 0);
});

test("a11y.axe is out of the default run: skipped with a hint, never silently passed", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--format", "json"]);
  assert.equal(result.code, EXIT.ok);
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const axe = report.skipped.find((s) => s.check === "a11y.axe");
  assert.ok(axe, "a11y.axe is skipped without --rendered");
  assert.equal(axe!.reason, "rendered-checks-disabled");
});
