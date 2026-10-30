// readability.webmcp: the tools a page registers through WebMCP, read in a real browser.
//
// The offline tests here stay offline and always run: they cover the whole decision (which is pure)
// and the skip paths. The rendered tests keep the fixture gate offline (rendered checks are opt-in,
// ADR 0005) and only run where a browser exists. One of them reads a page that answers with a stand-in
// model context, so the pipeline is proven on any Chromium; the one that needs the real API — a Chromium
// origin trial, so most machines have nothing of the kind — asserts the honest skip instead of pretending
// a positive result was reproduced.

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findBrowser } from "../src/browser.js";
import { runChecks, type RunResult } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { VIEWPORTS } from "../src/render.js";
import { probeWebMcp, readabilityWebMcp, anchorOf, addProblem, problemMessage, registrationAnchors, toolProblems, webMcpProblems, type MergedWebMcpProblem, type WebMcpObservation, type WebMcpToolShape } from "../src/checks/webmcp.js";
import { EXIT, run } from "../src/cli.js";
import { makeSite } from "./helpers.js";

// packages/verify/dist/tests/webmcp.test.js -> repository root is four levels up.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLEAN_FIXTURE = join(ROOT, "fixtures", "clean", "minimal", "site");

const TEXT = "<p>Enough readable text that this page is not a client-rendered shell.</p>";
/** The shape the draft asks for: a name, a sentence an agent can choose on, and an object schema. */
const WELL_FORMED = `<!doctype html>\n<html lang="en"><head><title>tools</title></head>\n<body><main><h1>Docs</h1>${TEXT}</main>\n<script>\n  document.modelContext?.registerTool({\n    name: "search-docs",\n    description: "Search the documentation for a phrase.",\n    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: [ "query" ] },\n    execute: async ({ query }) => ({ results: [ query ] }),\n  });\n</script></body></html>\n`;
/** No description, a name with a space in it, and a schema that is an array: an agent can use none of these. */
const MALFORMED = `<!doctype html>\n<html lang="en"><head><title>tools</title></head>\n<body><main><h1>Docs</h1>${TEXT}</main>\n<script>\n  document.modelContext?.registerTool({ name: "Bad Name", description: "", inputSchema: [], execute: async () => ({}) });\n</script></body></html>\n`;
/** A page about WebMCP that registers nothing: prose must not be read as a registration. */
const PROSE = `<!doctype html>\n<html lang="en"><head><title>notes</title></head>\n<body><main><h1>WebMCP</h1><p>We are watching the WebMCP draft and navigator.modelContext.registerTool.</p></main></body></html>\n`;
/** No WebMCP anywhere: the check has nothing to say about an ordinary page. */
const PLAIN = `<!doctype html>\n<html lang="en"><head><title>plain</title></head>\n<body><main><h1>Plain</h1>${TEXT}</main><script>console?.log("nothing to do with tools");</script></body></html>\n`;
/**
 * A page that hands out a model context answering with a tool list, in the shape the draft's `getTools()`
 * does: one registration that meets the draft and one that fails it on three counts. It is a stand-in for
 * the real API, not the real API, which is why it can prove the reading path on any Chromium build.
 */
const STAND_IN = `<!doctype html>\n<html lang="en"><head><title>stand-in</title></head>\n<body><main><h1>Docs</h1>${TEXT}</main>\n<script>\n  document.modelContext = {\n    getTools: async () => ([\n      { name: "search-docs", description: "Search the documentation for a phrase.", inputSchema: { type: "object", properties: { query: { type: "string" } } } },\n      { name: "Bad Name", description: "", inputSchema: [] },\n    ]),\n  };\n</script></body></html>\n`;

const site = (files: Record<string, string>): string => makeSite(files);
/** readability.webmcp alone, with the browser opted in the way --rendered does. */
const checkWith = async (root: string, browserPath?: string): Promise<RunResult> =>
  runChecks({
    site: buildSite(root),
    checks: [readabilityWebMcp],
    enable: { browser: true },
    ...(browserPath === undefined ? {} : { browser: { path: browserPath } }),
  });

const context = (files: Record<string, string>): Parameters<typeof probeWebMcp>[0] => ({ site: buildSite(makeSite(files)), options: {}, signal: new AbortController().signal });

const tool = (overrides: Partial<WebMcpToolShape> = {}): WebMcpToolShape => ({ scope: "page", nameType: "string", name: "search", hasDescription: true, schemaKind: "object", schemaType: "object", ...overrides });
const observed = (tools: readonly WebMcpToolShape[], rest: Partial<WebMcpObservation> = {}): WebMcpObservation => ({ supported: true, readable: true, listed: true, tools, ...rest });
const keys = (tools: readonly WebMcpToolShape[], registers = false, rest: Partial<WebMcpObservation> = {}): string[] => webMcpProblems(observed(tools, rest), registers).map((problem) => problem.key);

// ---- the decision, offline ---------------------------------------------------------------------------------------

test("a registration the draft would call well formed is not reported", () => {
  assert.deepEqual(keys([tool()]), []);
  // inputSchema is optional in the dictionary: a tool that takes no arguments may leave it out.
  assert.deepEqual(keys([tool({ schemaKind: "missing", schemaType: "" })]), []);
});

test("a page that registers nothing and never mentions WebMCP is silent", () => {
  assert.deepEqual(keys([], false), []);
  assert.deepEqual(keys([], false, { listed: false }), ["list-unavailable"], "a model context that cannot answer its list is still a finding");
});

test("a browser without WebMCP is not this check's business: it reports nothing and the probe skips", () => {
  assert.deepEqual(webMcpProblems(observed([tool({ hasDescription: false })], { supported: false, readable: false, listed: false }), true), []);
  // A context that answers with a surface this check does not know is the same: the probe skips, the page is not blamed.
  assert.deepEqual(webMcpProblems(observed([tool({ hasDescription: false })], { readable: false, listed: false }), true), []);
});

test("a page whose source registers but whose list is empty is reported once", () => {
  assert.deepEqual(keys([], true), ["no-registrations"]);
  assert.match(webMcpProblems(observed([]), true)[0]!.fix, /Register during load/);
  // A frame that registers is the frame document's own finding, not this page's claim of a lost registration.
  assert.deepEqual(keys([tool({ scope: "frame" })], false), ["frame-only"]);
});

test("a listing that does not answer is reported, and is not doubled by the empty-list note", () => {
  const problems = keys([tool()], false, { listed: false });
  assert.deepEqual(problems, ["list-unavailable"]);
  assert.deepEqual(keys([], true, { listed: false }), ["list-unavailable"]);
});

test("tools listed by the page and by a frame are both reachable from the page", () => {
  assert.deepEqual(keys([tool(), tool({ scope: "frame", name: "other" })]), []);
});

test("each malformed field is its own finding", () => {
  assert.deepEqual(keys([tool({ hasDescription: false })]), ["description:search"]);
  assert.deepEqual(keys([tool({ name: "" })]), ["name:#1"], "an unnamed tool is still described, so only the name is wrong");
  assert.deepEqual(keys([tool({ name: "", hasDescription: false })]), ["name:#1", "description:#1"]);
  assert.deepEqual(keys([tool({ name: "search docs" })]), ["name:search docs"]);
  assert.deepEqual(keys([tool({ nameType: "object", name: "" })]), ["name-type:#1"]);
  assert.deepEqual(keys([tool({ nameType: "object", name: "", hasDescription: false })]), ["name-type:#1", "description:#1"]);
  assert.deepEqual(keys([tool({ schemaKind: "array" })]), ["schema:search"]);
  assert.deepEqual(keys([tool({ schemaKind: "other" })]), ["schema:search"]);
  assert.deepEqual(keys([tool({ schemaType: "" })]), ["schema-type:search"]);
  assert.deepEqual(keys([tool({ schemaType: "string" })]), ["schema-type:search"]);
});

test("a bad name comes with a name the page could actually use", () => {
  const problem = toolProblems(tool({ name: "Search the Docs!" }), 0).find((p) => p.key === "name:Search the Docs!")!;
  assert.match(problem.message, /uses characters WebMCP names do not allow/);
  assert.match(problem.fix, /something like "Search-the-Docs"/);
  const empty = toolProblems(tool({ name: "  " }), 0).find((p) => p.key === "name:  ")!;
  assert.match(empty.message, /which is empty/);
  assert.match(empty.fix, /something like "my-tool"/);
});

test("the same name twice in one list is one finding; the same name in two documents is not", () => {
  assert.deepEqual(keys([tool(), tool()]), ["duplicate:search"]);
  assert.deepEqual(webMcpProblems(observed([tool(), tool()]), false).filter((p) => p.key.startsWith("duplicate:")).length, 1);
  assert.deepEqual(keys([tool(), tool({ scope: "frame" })]), []);
});

test("a report line names the widths it was seen at and says the standard is a draft", () => {
  const [problem] = webMcpProblems(observed([tool({ hasDescription: false })]), false);
  const line = problemMessage(problem!, VIEWPORTS);
  assert.match(line, /^the tool "search" has no description\./);
  assert.match(line, /Seen at phone \(375 px\), tablet \(768 px\), desktop \(1280 px\)\./);
  assert.match(line, /draft standard in a Chromium origin trial, so Seaworthy reports this as a note, not an error\./);
  assert.match(problemMessage(problem!, [VIEWPORTS[0]!]), /Seen at phone \(375 px\)\./);
});

test("one problem seen at several widths stays one finding naming every width", () => {
  const merged = new Map<string, MergedWebMcpProblem>();
  const problem = { key: "description:search", message: 'the tool "search" has no description.', fix: "Describe it." };
  const location = { file: "index.html", line: 4, column: 1 };
  for (const viewport of VIEWPORTS) addProblem(merged, { file: "index.html", problem, location, viewport });
  assert.equal(merged.size, 1);
  assert.deepEqual([...merged.values()][0]!.widths.map((viewport) => viewport.name), ["phone", "tablet", "desktop"]);
});

// ---- where a finding is anchored, offline ------------------------------------------------------------------------

test("the registration's own script is where the finding lands", () => {
  const root = makeSite({ "index.html": WELL_FORMED });
  const page = buildSite(root).pages.get("/index.html")!;
  const anchors = registrationAnchors(buildSite(root), page);
  assert.deepEqual(anchors.map((a) => a.kind), ["script"]);
  assert.deepEqual(anchorOf(page, anchors), { file: "index.html", line: 4, column: 1 });
});

test("a registration in a linked script or a frame's own file is anchored on the element that loads it", () => {
  const siteRoot = site({
    "index.html": '<!doctype html>\n<html lang="en"><head><title>s</title></head>\n<body><main><h1>Docs</h1></main>\n<script src="/assets/tools.js"></script>\n<iframe src="/widget.html"></iframe></body></html>\n',
    "assets/tools.js": "document.modelContext.registerTool({ name: 'a', description: 'A tool.', inputSchema: { type: 'object' }, execute: async () => ({}) });\n",
    "widget.html": "<!doctype html>\n<html lang=\"en\"><head><title>w</title></head><body><script>document.modelContext.registerTool({ name: 'b', description: 'B tool.', inputSchema: { type: 'object' }, execute: async () => ({}) });</script></body></html>\n",
  });
  const graph = buildSite(siteRoot);
  const page = graph.pages.get("/index.html")!;
  assert.deepEqual(registrationAnchors(graph, page).map((a) => a.kind), ["script", "frame"]);
  assert.deepEqual(anchorOf(page, registrationAnchors(graph, page)), { file: "index.html", line: 4, column: 1 }, "the page's own script comes before the frame");

  const widget = graph.pages.get("/widget.html")!;
  assert.deepEqual(registrationAnchors(graph, widget).map((a) => a.kind), ["script"]);
});

test("a script the site does not serve, and prose about WebMCP, are not read as registrations", () => {
  const graph = buildSite(site({ "index.html": PROSE }));
  assert.deepEqual(registrationAnchors(graph, graph.pages.get("/index.html")!), []);
  const remote = buildSite(site({ "index.html": '<!doctype html>\n<html lang="en"><head><title>r</title></head><body><main><p>Text.</p></main><script src="https://cdn.example/tools.js"></script></body></html>\n' }));
  assert.deepEqual(registrationAnchors(remote, remote.pages.get("/index.html")!), []);
  const toolElement = buildSite(site({ "index.html": '<!doctype html>\n<html lang="en"><head><title>t</title></head><body><main><p>Text.</p><tool name="search" description="Search the docs."></tool></main></body></html>\n' }));
  assert.deepEqual(registrationAnchors(toolElement, toolElement.pages.get("/index.html")!).map((a) => a.kind), ["tool"]);
});

test("with nothing to anchor on, a finding is anchored on the document", () => {
  const graph = buildSite(site({ "index.html": PLAIN }));
  const page = graph.pages.get("/index.html")!;
  const at = anchorOf(page, []);
  assert.equal(at.file, "index.html");
  assert.equal(at.line, 2, "the document's own <head>, never a guessed element somewhere else in the file");
  assert.equal(at.selector, undefined);
});

// ---- the metadata and the skip paths, offline --------------------------------------------------------------------

test("the check is an experimental note that needs a rendered page", () => {
  assert.equal(readabilityWebMcp.meta.id, "readability.webmcp");
  assert.equal(readabilityWebMcp.meta.severity, "note");
  assert.deepEqual(readabilityWebMcp.meta.needs, ["html", "browser"]);
  assert.match(readabilityWebMcp.meta.standards.join(" "), /draft/);
  assert.equal(typeof readabilityWebMcp.probe, "function");
});

test("a given browser path that is missing is a skip with a pointed hint, not a crash", async () => {
  const result = await checkWith(site({ "index.html": WELL_FORMED }), "/no/such/browser/anywhere");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped.map((s) => [s.check, s.reason]), [["readability.webmcp", "browser-unavailable"]]);
  assert.match(result.skipped[0]!.hint, /does not exist/);
});

test("the CLI wires --rendered and --browser-path in: the check is skipped when the path is missing", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--rendered", "--browser-path", "/no/such/browser/anywhere", "--format", "json"]);
  assert.equal(result.code, EXIT.ok, "a skip is not a failure");
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string; hint: string }[] };
  const webmcp = report.skipped.find((s) => s.check === "readability.webmcp");
  assert.ok(webmcp, "readability.webmcp is named under skipped");
  assert.equal(webmcp!.reason, "browser-unavailable");
  assert.ok(webmcp!.hint.length > 0);
});

test("readability.webmcp is out of the default run: skipped with a hint, never silently passed", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--format", "json"]);
  assert.equal(result.code, EXIT.ok);
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string }[] };
  const webmcp = report.skipped.find((s) => s.check === "readability.webmcp");
  assert.ok(webmcp, "readability.webmcp is skipped without --rendered");
  assert.equal(webmcp!.reason, "rendered-checks-disabled");
});

// ---- in a browser -------------------------------------------------------------------------------------------------

// These are the honest half. A page's tools can only be read by a browser that answers with a model
// context, and while the standard is a Chromium origin trial most machines have none: those machines
// assert the skip instead, because a passing check there would mean nothing — the tools were never read.

test("a browser that cannot read WebMCP makes the check skip, never pass", async () => {
  if (findBrowser() === undefined) return; // no browser at all: the engine-level skip tests above are the contract
  const skip = await probeWebMcp(context({ "index.html": WELL_FORMED }));
  if (skip === undefined) return; // this browser lists tools: the last test here is the contract
  assert.ok(
    skip.reason === "webmcp-unsupported" || skip.reason === "webmcp-surface-unknown",
    `expected a WebMCP skip reason, got ${skip.reason}`,
  );
  assert.match(skip.hint, /docs\/checks\/readability\.webmcp\.md/);
  if (skip.reason === "webmcp-surface-unknown") return;
  assert.match(skip.hint, /chrome:\/\/flags\/#enable-webmcp-testing/);
  assert.match(skip.hint, /Chrome 149-156/, "the origin trial window is written into the hint, so the skip says what would fix it");
});

test("the check reports nothing about a page that has no tools to report, on a real browser", async () => {
  if (findBrowser() === undefined) return;
  for (const name of ["PROSE", "PLAIN"] as const) {
    const result = await checkWith(site({ "index.html": { PROSE, PLAIN }[name] }));
    assert.deepEqual(result.errors, [], name);
    assert.deepEqual(result.findings, [], `${name}: no registration means no WebMCP finding, whatever the browser can do`);
  }
});

test("a page that lists its own tools is read the way an agent reads it, on any browser", async () => {
  // This is the check's whole pipeline against a real browser: load the built file over file://, read the
  // model context's list, compare each entry to the draft, merge the widths, and locate the finding on the
  // script that registers. The page's context is a stand-in for the API rather than the API, so this runs
  // wherever a browser exists; the test after it is the one that needs a browser with real WebMCP.
  if (findBrowser() === undefined) return;
  const result = await checkWith(site({ "index.html": STAND_IN }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skipped, [], "a page that answers with a model context is a page this check can read");
  assert.equal(result.findings.length, 3, "the well formed registration is silent and the malformed one is reported field by field");
  const messages = result.findings.map((finding) => finding.message).join("\n");
  assert.match(messages, /has the name "Bad Name", which uses characters WebMCP names do not allow/);
  assert.match(messages, /the tool "Bad Name" has no description/);
  assert.match(messages, /the tool "Bad Name" records an inputSchema that is an array/);
  assert.doesNotMatch(messages, /search-docs/, "a registration the draft would call well formed says nothing");
  for (const finding of result.findings) {
    assert.equal(finding.severity, "note");
    assert.equal(finding.location.file, "index.html");
    assert.equal(finding.location.line, 4, "the script element that carries the registration");
    assert.match(finding.message, /Seen at phone \(375 px\), tablet \(768 px\), desktop \(1280 px\)\./);
    assert.match(finding.message, /draft standard in a Chromium origin trial/);
    assert.equal(finding.fix.kind, "manual");
  }
});

test("a well formed registration is silent and a malformed one is notes, on a browser that can list tools", async () => {
  if (findBrowser() === undefined) return;
  const clean = await checkWith(site({ "index.html": WELL_FORMED }));
  if (clean.skipped.length > 0) return; // this machine's browser cannot do WebMCP: the skip above is the contract
  assert.deepEqual(clean.errors, []);
  assert.deepEqual(clean.findings, [], "the page's registration is exactly what the draft asks for");

  const broken = await checkWith(site({ "index.html": MALFORMED }));
  assert.deepEqual(broken.errors, []);
  assert.ok(broken.findings.length >= 1, "a malformed registration is reported, or the browser refused to list it and the empty list is");
  for (const finding of broken.findings) {
    assert.equal(finding.severity, "note", "a draft standard is never an error");
    assert.equal(finding.location.file, "index.html");
  }
  // Which notes appear depends on the build: a spec-conformant Chromium rejects the descriptor at
  // registration, so the page lists nothing and the note is about the lost registration; a build that
  // accepts it yields the field notes. Both are honest, so the assertions below are conditional.
  const messages = broken.findings.map((finding) => finding.message).join("\n");
  assert.match(messages, /Bad Name|lists none|did not answer/);
});

