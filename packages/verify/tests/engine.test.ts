import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprint, runChecks, validateCheckId } from "../src/engine.js";
import { buildReport, reportToJson } from "../src/report.js";
import { buildSite } from "../src/site.js";
import type { Check, CheckMeta, FindingDraft } from "../src/types.js";
import { makeSite } from "./helpers.js";

const meta = (id: string, over: Partial<CheckMeta> = {}): CheckMeta => ({ id, title: id, severity: "error", needs: ["html"], docs: `https://example.test/${id}`, standards: [], ...over });
const draft = (file: string, line: number | undefined, key: string, over: Partial<FindingDraft> = {}): FindingDraft => ({
  message: `problem ${key}`,
  location: line === undefined ? { file } : { file, line },
  fix: { kind: "manual", summary: "fix it" },
  key,
  ...over,
});
const site = () => buildSite(makeSite({ "index.html": "<!doctype html><title>t</title>" }));

test("fingerprints ignore line numbers and differ by check, file, and key", () => {
  assert.equal(fingerprint("links.internal", "a.html", "/x"), fingerprint("links.internal", "a.html", "/x"));
  assert.match(fingerprint("links.internal", "a.html", "/x"), /^[0-9a-f]{16}$/);
  assert.notEqual(fingerprint("links.internal", "a.html", "/x"), fingerprint("images.alt", "a.html", "/x"));
  assert.notEqual(fingerprint("links.internal", "a.html", "/x"), fingerprint("links.internal", "b.html", "/x"));
  assert.notEqual(fingerprint("links.internal", "a.html", "/x"), fingerprint("links.internal", "a.html", "/y"));
});

test("a finding keeps its fingerprint when its line moves", async () => {
  const run = async (line: number) => {
    const check: Check = { meta: meta("links.internal"), run: () => [draft("a.html", line, "/x")] };
    return (await runChecks({ site: site(), checks: [check] })).findings[0]!.fingerprint;
  };
  assert.equal(await run(3), await run(300));
});

test("validates check IDs", () => {
  for (const id of ["links.internal", "a11y.color-contrast", "meta.og-image.size"]) validateCheckId(id);
  for (const id of ["links", "Links.internal", "links_internal", ".x", "links.", "1a.b"]) assert.throws(() => validateCheckId(id), /invalid check ID/, id);
});

test("rejects duplicate check IDs", async () => {
  const a: Check = { meta: meta("x.a"), run: () => [] };
  await assert.rejects(runChecks({ site: site(), checks: [a, a] }), /duplicate check ID x\.a/);
});

test("fills severity, fingerprint, and appliesTo; draft severity wins; config override beats the default", async () => {
  const check: Check = { meta: meta("x.a", { severity: "warning" }), run: () => [draft("a.html", 1, "k1"), draft("a.html", 2, "k2", { severity: "note" })] };
  const plain = await runChecks({ site: site(), checks: [check] });
  assert.deepEqual(plain.findings.map((f) => f.severity), ["warning", "note"]);
  assert.ok(plain.findings.every((f) => f.fix.appliesTo === "built-output" && f.fix.edits.length === 0));
  const overridden = await runChecks({ site: site(), checks: [check], severity: { "x.a": "error" } });
  assert.deepEqual(overridden.findings.map((f) => f.severity), ["error", "note"]);
});

test("accepts sync and async iterables", async () => {
  const sync: Check = { meta: meta("x.sync"), run: () => [draft("a.html", 1, "s")] };
  const asyncCheck: Check = {
    meta: meta("x.async"),
    async *run() {
      yield draft("a.html", 1, "a");
    },
  };
  const { findings } = await runChecks({ site: site(), checks: [sync, asyncCheck] });
  assert.deepEqual(findings.map((f) => f.checkId).sort(), ["x.async", "x.sync"]);
});

test("a check that throws is recorded and the others still run", async () => {
  const bad: Check = {
    meta: meta("x.bad"),
    run() {
      throw new Error("boom");
    },
  };
  const good: Check = { meta: meta("x.good"), run: () => [draft("a.html", 1, "k")] };
  const result = await runChecks({ site: site(), checks: [bad, good] });
  assert.deepEqual(result.errors, [{ check: "x.bad", message: "boom" }]);
  assert.equal(result.findings.length, 1);
});

test("checks that need a browser or the network are skipped unless enabled, never passed silently", async () => {
  let ran = 0;
  const rendered: Check = { meta: meta("a11y.axe", { needs: ["html", "browser"] }), run: () => (ran++, []) };
  const online: Check = { meta: meta("links.external", { needs: ["html", "network"] }), run: () => (ran++, []) };
  const off = await runChecks({ site: site(), checks: [rendered, online] });
  assert.equal(ran, 0);
  assert.deepEqual(off.skipped.map((s) => [s.check, s.reason]), [["a11y.axe", "rendered-checks-disabled"], ["links.external", "network-checks-disabled"]]);
  assert.ok(off.skipped.every((s) => s.hint.length > 0));
  const on = await runChecks({ site: site(), checks: [rendered, online], enable: { browser: true, network: true } });
  assert.equal(ran, 2);
  assert.deepEqual(on.skipped, []);
});

test("passes per-check options and an abort signal to the check", async () => {
  let seen: unknown;
  const check: Check = { meta: meta("x.opts"), run: (ctx) => ((seen = [ctx.options, ctx.signal.aborted]), []) };
  await runChecks({ site: site(), checks: [check], options: { "x.opts": { max: 3 } } });
  assert.deepEqual(seen, [{ max: 3 }, false]);
});

test("reports are sorted and byte-identical across runs", async () => {
  const check: Check = {
    meta: meta("x.a"),
    run: () => [draft("b.html", 5, "k1"), draft("a.html", 9, "k2"), draft("a.html", 2, "k3"), draft("a.html", undefined, "k4")],
  };
  const make = async () => {
    const result = await runChecks({ site: site(), checks: [check] });
    return reportToJson(buildReport({ root: "dist", pages: 1, checks: [check], findings: result.findings }));
  };
  const first = await make();
  assert.equal(first, await make());
  const report = JSON.parse(first);
  assert.deepEqual(report.findings.map((f: { location: { file: string; line?: number } }) => `${f.location.file}:${f.location.line ?? "-"}`), ["a.html:2", "a.html:9", "a.html:-", "b.html:5"]);
  assert.deepEqual(report.summary, { pages: 1, findings: 4, bySeverity: { error: 4 }, suppressed: 0, baselined: 0, baselineStale: 0 });
  assert.ok(first.endsWith("}\n"));
});

test("refuses an absolute report root", () => {
  assert.throws(() => buildReport({ root: "/Users/me/site/dist", pages: 0, checks: [], findings: [] }), /relative/);
  assert.throws(() => buildReport({ root: "C:\\site\\dist", pages: 0, checks: [], findings: [] }), /relative/);
  assert.doesNotThrow(() => buildReport({ root: "dist", pages: 0, checks: [], findings: [] }));
});
