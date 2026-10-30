// Screenshot evidence: the crop a rendered finding keeps as proof, under --rendered --evidence.
// The offline tests here need no browser: they pin the clip arithmetic, the writer, the engine
// pass-through, and — the load-bearing one — that a run without the opt-in produces exactly the
// report bytes it produced before. The tests that drive a real browser follow the a11y-axe
// precedent and skip on a machine without one.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { findBrowser } from "../src/browser.js";
import { runChecks } from "../src/engine.js";
import { saveCrop } from "../src/evidence.js";
import { buildReport } from "../src/report.js";
import { buildSite } from "../src/site.js";
import { cropClip, cropElement, VIEWPORTS, type PlaywrightPage } from "../src/render.js";
import type { Check, EvidenceSink, FindingDraft } from "../src/types.js";
import { a11yAxe } from "../src/checks/a11y-axe.js";
import { EXIT, run } from "../src/cli.js";
import { makeSite, reportErrors } from "./helpers.js";

// packages/verify/dist/tests/evidence.test.js -> repository root is four levels up.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLEAN_FIXTURE = join(ROOT, "fixtures", "clean", "minimal", "site");

const BROKEN = "<!doctype html>\n<html lang=\"en\"><head><title>broken</title></head>\n<body><main><p style=\"color: #999999\">Text that fails contrast against white.</p></main></body></html>\n";

const tempDir = (): string => mkdtempSync(join(tmpdir(), "seaworthy-evidence-"));
const PHONE = VIEWPORTS[0]!;

test("a crop is the element box plus 24 px of context on every side", () => {
  assert.deepEqual(cropClip({ x: 100, y: 100, width: 40, height: 20 }, PHONE), { x: 76, y: 76, width: 88, height: 68 });
});

test("the crop clamps to the viewport: only pixels that exist are asked for", () => {
  assert.deepEqual(cropClip({ x: 0, y: 0, width: 375, height: 667 }, PHONE), { x: 0, y: 0, width: 375, height: 667 }, "a full-viewport element crops to the viewport");
  assert.deepEqual(cropClip({ x: 350, y: 600, width: 20, height: 50 }, PHONE), { x: 326, y: 576, width: 49, height: 91 });
  assert.equal(cropClip({ x: 400, y: 10, width: 30, height: 10 }, PHONE), undefined, "an element fully past the right edge has no crop");
  assert.equal(cropClip({ x: 10, y: 10, width: 0, height: 30 }, PHONE), undefined, "a zero-width box is not a finding worth cropping");
});

/** A page stand-in that records what the crop asked the browser for. */
const fakePage = (locator: { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>; scrollIntoViewIfNeeded: () => Promise<void> }, clip: unknown[] = []): { page: PlaywrightPage; shot: () => Buffer | undefined } => {
  let captured: Buffer | undefined;
  const page = {
    goto: async () => {},
    addScriptTag: async () => {},
    evaluate: async <R>(): Promise<R> => undefined as unknown as R,
    close: async () => {},
    locator: () => locator,
    screenshot: async (options: { clip: unknown }) => {
      clip.push(options.clip);
      captured = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      return captured;
    },
  } satisfies PlaywrightPage;
  return { page, shot: () => captured };
};

test("cropElement scrolls the element into view and screenshots its padded box", async () => {
  const clips: unknown[] = [];
  const { page, shot } = fakePage({ boundingBox: async () => ({ x: 100, y: 100, width: 40, height: 20 }), scrollIntoViewIfNeeded: async () => {} }, clips);
  const png = await cropElement(page, "main > p", PHONE);
  assert.deepEqual(png, shot(), "the browser's bytes come back untouched — no re-encoding");
  assert.deepEqual(clips[0], cropClip({ x: 100, y: 100, width: 40, height: 20 }, PHONE));
});

test("a crop that cannot be taken is no evidence and never an error", async () => {
  const gone = fakePage({ boundingBox: async () => null, scrollIntoViewIfNeeded: async () => {} });
  assert.equal(await cropElement(gone.page, "main > p", PHONE), undefined);
  const noSuchElement = { ...fakePage({ boundingBox: async () => null, scrollIntoViewIfNeeded: async () => {} }).page, locator: () => { throw new Error("no such element"); } };
  assert.equal(await cropElement(noSuchElement, "main > p", PHONE), undefined, "untrusted pages yield odd selectors; a failed crop must not fail the run");
});

test("saveCrop writes into the evidence folder and names the path the way the report does", () => {
  const base = tempDir();
  const sink: EvidenceSink = { dir: join(base, "evidence"), label: "evidence" };
  assert.equal(saveCrop(sink, "abc.png", Buffer.from("x")), "evidence/abc.png");
  assert.equal(readFileSync(join(base, "evidence", "abc.png"), "utf8"), "x", "the folder is created on demand, never before a crop exists");
  assert.equal(saveCrop({ dir: base, label: "" }, "abc.png", Buffer.from("y")), "abc.png", "the run folder itself needs no prefix");
});

const echoing = (draft: FindingDraft): Check => ({
  meta: { id: "test.echo", title: "Echoes a draft", severity: "warning", needs: ["html"], docs: "https://example.test/test.echo", standards: [] },
  run: (context) => { seenContext = context; return [draft]; },
});
let seenContext: Parameters<Check["run"]>[0] | undefined;

const draftOf = (evidence?: { image: string; viewport: string }): FindingDraft => ({
  message: "A problem.",
  location: { file: "index.html", selector: "main > p" },
  fix: { kind: "manual", summary: "Fix it." },
  key: "main > p",
  ...(evidence === undefined ? {} : { evidence }),
});

test("without --evidence the engine passes no evidence around, and a finding keeps exactly the fields it had before", async () => {
  seenContext = undefined;
  const { findings } = await runChecks({ site: buildSite(makeSite({ "index.html": "<!doctype html><title>t</title>" })), checks: [echoing(draftOf())] });
  assert.equal(seenContext !== undefined && "evidence" in seenContext, false, "a run without the opt-in shows checks no evidence sink at all");
  assert.deepEqual(Object.keys(findings[0]!), ["checkId", "severity", "message", "location", "fix", "fingerprint"]);
  const report = buildReport({ root: "site", pages: 1, checks: [echoing(draftOf())], findings });
  assert.equal(JSON.stringify(report).includes("evidence"), false, "no `evidence` key, not even a null one: the JSON bytes are unchanged");
  assert.deepEqual(reportErrors(report), []);
});

test("an evidence field rides from the draft onto the finding and validates against the schema", async () => {
  const { findings } = await runChecks({ site: buildSite(makeSite({ "index.html": "<!doctype html><title>t</title>" })), checks: [echoing(draftOf({ image: "evidence/0123456789abcdef.png", viewport: "phone" }))], evidence: { dir: tempDir(), label: "evidence" } });
  assert.deepEqual(Object.keys(findings[0]!), ["checkId", "severity", "message", "location", "fix", "fingerprint", "evidence"]);
  assert.equal(findings[0]!.evidence!.image, "evidence/0123456789abcdef.png");
  assert.deepEqual(reportErrors(buildReport({ root: "site", pages: 1, checks: [echoing(draftOf())], findings })), [], "the additive optional field is part of the contract");
});

test("the schema rejects an evidence path that is absolute or backslashed", async () => {
  const { findings } = await runChecks({ site: buildSite(makeSite({ "index.html": "<!doctype html><title>t</title>" })), checks: [echoing(draftOf({ image: "/tmp/evidence/x.png", viewport: "phone" }))] });
  assert.notDeepEqual(reportErrors(buildReport({ root: "site", pages: 1, checks: [echoing(draftOf())], findings })), []);
});

test("--evidence without --rendered is a usage error naming the flag it needs", async () => {
  const result = await run(["verify", CLEAN_FIXTURE, "--evidence", "evidence"], { cwd: makeSite({}) });
  assert.equal(result.code, EXIT.usage);
  assert.match(result.stderr, /--evidence saves crops for rendered findings; add --rendered/);
});

test("--evidence refuses an absolute folder and one inside the verified site", async () => {
  const fromElsewhere = await run(["verify", CLEAN_FIXTURE, "--rendered", "--evidence", "/tmp/seaworthy-evidence"], { cwd: makeSite({}) });
  assert.equal(fromElsewhere.code, EXIT.usage);
  assert.match(fromElsewhere.stderr, /relative to where you run Seaworthy/);
  const insideSite = await run(["verify", ".", "--rendered", "--evidence", "evidence"], { cwd: CLEAN_FIXTURE });
  assert.equal(insideSite.code, EXIT.usage);
  assert.match(insideSite.stderr, /never writes in the site it verifies/);
});

test("opted in on a machine with no browser: a11y.axe skips like it always did, nothing is written", async () => {
  const cwd = makeSite({});
  const result = await run(["verify", CLEAN_FIXTURE, "--rendered", "--evidence", "evidence", "--browser-path", "/no/such/browser/anywhere", "--format", "json", "--no-history"], { cwd });
  assert.equal(result.code, EXIT.ok, "a skip is not a failure, with or without evidence");
  const report = JSON.parse(result.stdout) as { skipped: { check: string; reason: string }[]; findings: unknown[] };
  assert.deepEqual(report.findings, []);
  assert.equal(report.skipped.find((s) => s.check === "a11y.axe")?.reason, "browser-unavailable");
  assert.equal(existsSync(join(cwd, "evidence")), false, "no crop, no folder");
});

// From here the tests drive a real browser, like the rendered half of a11y-axe.test.ts:
// machines without one skip them, and the skip contract above is what they leave proved.

const axeWithEvidence = async (label: string): Promise<{ findings: Awaited<ReturnType<typeof runChecks>>["findings"]; sink: EvidenceSink }> => {
  const sink: EvidenceSink = { dir: join(tempDir(), label), label };
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": BROKEN })), checks: [a11yAxe], enable: { browser: true }, evidence: sink });
  return { findings: result.findings, sink };
};

test("opted in with a browser: each rendered finding gains a crop, referenced by a relative path", async () => {
  if (findBrowser() === undefined) return;
  const { findings, sink } = await axeWithEvidence("evidence");
  assert.equal(findings.length, 1);
  const finding = findings[0]!;
  assert.ok(finding.evidence, "the rendered finding carries its proof");
  assert.equal(finding.evidence!.image, `evidence/${finding.fingerprint}.png`, "named by the fingerprint, and relative: no absolute path reaches the report");
  assert.equal(finding.evidence!.viewport, "phone", "the crop comes from the width the problem was first seen at");
  const png = readFileSync(join(sink.dir, `${finding.fingerprint}.png`));
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "the browser's PNG bytes, written out as they came");
});

test("two runs of the same site name the same crops and report the same bytes", async () => {
  if (findBrowser() === undefined) return;
  const first = await axeWithEvidence("evidence");
  const second = await axeWithEvidence("evidence");
  assert.equal(JSON.stringify(second.findings), JSON.stringify(first.findings), "names and paths are derived, never generated from the clock");
  assert.deepEqual(readdirSync(first.sink.dir), readdirSync(second.sink.dir));
});

test("the CLI wires --evidence end to end: the report's crop exists under the folder it names", async () => {
  if (findBrowser() === undefined) return;
  const cwd = makeSite({});
  const site = makeSite({ "index.html": BROKEN });
  const result = await run(["verify", site, "--rendered", "--evidence", "evidence", "--format", "json", "--no-history"], { cwd });
  const report = JSON.parse(result.stdout) as { findings: { checkId: string; fingerprint: string; evidence?: { image: string; viewport: string } }[] };
  const axeFindings = report.findings.filter((f) => f.checkId === "a11y.axe");
  assert.equal(axeFindings.length, 1);
  assert.ok(axeFindings[0]!.evidence, "--evidence through the CLI reaches the rendered finding");
  assert.equal(axeFindings[0]!.evidence!.image, `evidence/${axeFindings[0]!.fingerprint}.png`);
  assert.ok(existsSync(join(cwd, "evidence", `${axeFindings[0]!.fingerprint}.png`)), "the report's path resolves from the folder the command ran in");
  for (const finding of report.findings.filter((f) => f.checkId !== "a11y.axe")) assert.equal(finding.evidence, undefined, "a static finding gains no evidence: there are no pixels behind it");
});
