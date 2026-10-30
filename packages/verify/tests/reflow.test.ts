// layout.reflow: content that does not reflow at a 320 CSS px viewport (WCAG 1.4.10).
// The offline tests here stay offline: pages load from file:// URLs inside the check, remote
// requests are aborted by the shared render context, and the skip tests need no browser at
// all. The rendered tests only run when this machine has a browser to launch, like a11y-axe's.

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findBrowser } from "../src/browser.js";
import { runChecks, type RunResult } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { layoutReflow } from "../src/checks/reflow.js";
import { EXIT, run } from "../src/cli.js";
import { makeSite } from "./helpers.js";

// packages/verify/dist/tests/reflow.test.js -> repository root is four levels up.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLEAN_FIXTURE = join(ROOT, "fixtures", "clean", "minimal", "site");

const HEAD = '<!doctype html>\n<html lang="en"><head><title>reflow</title>';
const END = "</head>\n<body>";

// A single column that reflows: every box shrinks with the viewport.
const REFLOWS = `${HEAD}<style>body{margin:0}</style>${END}<main><p>Text that wraps at any width, however narrow.</p><div style="background:#eee">A block that fits.</div></main></body></html>\n`;

// The finding: a box kept at 600 px by an explicit width, inside a paragraph that is wide only because its parent is.
const FIXED_WIDTH = `${HEAD}<style>body{margin:0}.banner{width:600px;background:#eee}</style>${END}<main><div class="banner"><p>Sized in pixels, so nothing shrinks at 320 CSS px.</p></div></main></body></html>\n`;

// Two-dimensional content presented as such, in its own scroll container: the criterion's exception, a pass.
const TABLE_IN_SCROLLER = `${HEAD}<style>body{margin:0}.scroller{overflow-x:auto;max-width:100%}table{width:600px}</style>${END}<main><div class="scroller"><table><tr><td>wide</td><td>data</td></tr></table></div></main></body></html>\n`;

// A wide table with no scroller: tabular data may keep two dimensions under the same exception.
const TABLE_BARE = `${HEAD}<style>body{margin:0}table{width:600px}</style>${END}<main><table><tr><td>wide</td><td>data</td></tr></table></main></body></html>\n`;

// A fixed width the author chose that FITS the viewport: nothing pans, nothing to report.
const FIXED_SMALL = `${HEAD}<style>body{margin:0}.badge{width:280px;background:#eee}</style>${END}<main><div class="badge">Intentionally 280 px.</div></main></body></html>\n`;

// The page is wider than 320 px only because of an image, and the image scales: a pass.
// The 1x1 GIF data URI keeps the test offline; the width and height attributes give it the 1200 px box.
const PIXEL_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const SCALING_IMAGE = `${HEAD}<style>body{margin:0}img{max-width:100%;height:auto}</style>${END}<main><img src="${PIXEL_GIF}" width="1200" height="400" alt=""></main></body></html>\n`;

// The same image unscaled: the replaced element itself keeps 1200 px, so this is the finding.
const UNSCALED_IMAGE = `${HEAD}<style>body{margin:0}</style>${END}<main><img src="${PIXEL_GIF}" width="1200" height="400" alt=""></main></body></html>\n`;

// layout.horizontal-overflow's symptom: the document pans sideways because of a long unbreakable
// word, with no fixed-size box anywhere. One problem, one finding: not this check's.
const LONG_WORD = `${HEAD}<style>body{margin:0}</style>${END}<main><p>Supercalifragilisticexpialidocious${"x".repeat(400)}Supercalifragilisticexpialidocious</p></main></body></html>\n`;

// layout.text-clipped's symptom: text wider than its own clipped container. The clip absorbs the
// overflow, the document never pans, and an element's cut-off text is the sibling's finding.
const CLIPPED_TEXT = `${HEAD}<style>body{margin:0}.clip{width:300px;overflow:hidden;white-space:nowrap}span.big{display:inline-block;width:500px}</style>${END}<main><div class="clip"><span class="big">Text cut off by its own container.</span></div></main></body></html>\n`;

const site = (page: string): string => makeSite({ "index.html": page });
/** layout.reflow alone, with the browser opted in like --rendered does. */
const checkWith = async (root: string, browserPath?: string): Promise<RunResult> =>
  runChecks({
    site: buildSite(root),
    checks: [layoutReflow],
    enable: { browser: true },
    ...(browserPath === undefined ? {} : { browser: { path: browserPath } }),
  });

test("a given browser path that is missing is a skip with a pointed hint, not a crash", async () => {
  const result = await checkWith(site(REFLOWS), "/no/such/browser/anywhere");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped.map((s) => [s.check, s.reason]), [["layout.reflow", "browser-unavailable"]]);
  assert.ok(result.skipped.every((s) => /does not exist/.test(s.hint) && s.hint.length > 0));
});

test("a single-column page that reflows, and a fits-the-viewport fixed width, are silent", async () => {
  if (findBrowser() === undefined) return; // no browser on this machine: the probe skip above is the contract
  assert.deepEqual((await checkWith(site(REFLOWS))).findings, []);
  assert.deepEqual((await checkWith(site(FIXED_SMALL))).findings, []);
});

test("two-dimensional content keeps the criterion's exceptions: tables pass, scrollers absorb", async () => {
  if (findBrowser() === undefined) return;
  assert.deepEqual((await checkWith(site(TABLE_IN_SCROLLER))).findings, [], "a wide table inside its own scroll container reflows the page around it");
  assert.deepEqual((await checkWith(site(TABLE_BARE))).findings, [], "tabular data presented as such may keep two dimensions (WCAG 1.4.10 exception)");
});

test("a page wider than 320 px only because of an image is a pass only while the image scales", async () => {
  if (findBrowser() === undefined) return;
  assert.deepEqual((await checkWith(site(SCALING_IMAGE))).findings, []);
  const unscaled = await checkWith(site(UNSCALED_IMAGE));
  assert.equal(unscaled.findings.length, 1);
  assert.match(unscaled.findings[0]!.message, /<img> stays 1200 CSS px wide/);
});

test("the page that never reflows is one finding, on the outermost fixed box", async () => {
  if (findBrowser() === undefined) return;
  const result = await checkWith(site(FIXED_WIDTH));
  assert.equal(result.findings.length, 1, "the wide <p> inside the wide <div> is the same problem, not a second finding");
  const finding = result.findings[0]!;
  assert.equal(finding.checkId, "layout.reflow");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.location.file, "index.html");
  assert.ok(finding.location.selector !== undefined && /body.*>.*div/.test(finding.location.selector));
  assert.ok(finding.location.snippet !== undefined && finding.location.snippet.includes('class="banner"'));
  assert.match(finding.message, /^Content does not reflow: <div> stays 600 CSS px wide at the 320 px viewport/);
  assert.match(finding.message, /Seen at small phone \(320 px\)\./, "the finding names the width it was measured at");
  assert.match(finding.fix.summary, /max-width:100%/);
});

test("the symptoms the siblings own report nothing here: sideways pan without a fixed box, clipped text", async () => {
  if (findBrowser() === undefined) return;
  assert.deepEqual((await checkWith(site(LONG_WORD))).findings, [], "the document scrolling sideways is layout.horizontal-overflow's finding");
  assert.deepEqual((await checkWith(site(CLIPPED_TEXT))).findings, [], "an element whose own text is cut off is layout.text-clipped's finding");
});

test("the CLI wires --rendered and --browser-path in: layout.reflow is skipped when the path is missing", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--rendered", "--browser-path", "/no/such/browser/anywhere", "--format", "json"]);
  assert.equal(result.code, EXIT.ok, "a skip is not a failure");
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const reflow = report.skipped.find((s) => s.check === "layout.reflow");
  assert.ok(reflow, "layout.reflow is named under skipped");
  assert.equal(reflow!.reason, "browser-unavailable");
  assert.ok(reflow!.hint.length > 0);
});

test("layout.reflow is out of the default run: skipped with a hint, never silently passed", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--format", "json"]);
  assert.equal(result.code, EXIT.ok);
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const reflow = report.skipped.find((s) => s.check === "layout.reflow");
  assert.ok(reflow, "layout.reflow is skipped without --rendered");
  assert.equal(reflow!.reason, "rendered-checks-disabled");
});
