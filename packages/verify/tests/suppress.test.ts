import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprint } from "../src/engine.js";
import { applySuppressions, fromConfig, parseInlineSuppressions } from "../src/suppress.js";
import { buildSite } from "../src/site.js";
import type { Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const KNOWN = ["links.internal", "images.alt", "a11y.color-contrast"];
const finding = (checkId: string, file: string, line: number | undefined, key = "k"): Finding => ({
  checkId,
  severity: "error",
  message: `${checkId} problem`,
  location: line === undefined ? { file } : { file, line },
  fix: { kind: "manual", summary: "fix it", edits: [], appliesTo: "built-output" },
  fingerprint: fingerprint(checkId, file, key),
});
const NOW = new Date("2027-02-01T12:00:00Z");

const site = (body: string) => buildSite(makeSite({ "a.html": body }));

test("an inline comment covers its own line and the next, and nothing further", () => {
  const { suppressions, problems } = parseInlineSuppressions(site("<p>one</p>\n<!-- seaworthy-ignore images.alt: decorative sprite -->\n<img src=a.png>\n<img src=b.png>\n"), KNOWN);
  assert.deepEqual(problems, []);
  const result = applySuppressions([finding("images.alt", "a.html", 2), finding("images.alt", "a.html", 3), finding("images.alt", "a.html", 4), finding("images.alt", "other.html", 3)], suppressions, NOW);
  assert.deepEqual(result.findings.map((f) => `${f.location.file}:${f.location.line}`), ["a.html:4", "other.html:3"]);
  assert.deepEqual(result.suppressed.map((s) => [s.file, s.line, s.reason, s.source]), [["a.html", 2, "decorative sprite", "inline"], ["a.html", 3, "decorative sprite", "inline"]]);
});

test("an inline comment applies only to the check IDs it names; prefixes work", () => {
  const { suppressions } = parseInlineSuppressions(site("<!-- seaworthy-ignore a11y.*, links.internal: legacy page -->\n<a href=x>x</a>\n"), KNOWN);
  const all = [finding("a11y.color-contrast", "a.html", 2), finding("links.internal", "a.html", 2), finding("images.alt", "a.html", 2)];
  assert.deepEqual(applySuppressions(all, suppressions, NOW).findings.map((f) => f.checkId), ["images.alt"]);
});

test("malformed comments become suppress.invalid findings instead of silently doing nothing", () => {
  const body = [
    "<!-- seaworthy-ignore images.alt -->", //                      no colon or reason
    "<!-- seaworthy-ignore: just because -->", //                   no check ID
    "<!-- seaworthy-ignore images.alt: -->", //                     empty reason
    "<!-- seaworthy-ignore images.alt: ok -->", //                  reason too short
    "<!-- seaworthy-ignore imagez.alt: typo in the ID -->", //      unknown ID
    "<!-- seaworthy-ignore images.alt: fine until 2027-99-99 -->", // impossible date
  ].join("\n");
  const { suppressions, problems } = parseInlineSuppressions(site(body), KNOWN);
  assert.equal(suppressions.length, 0);
  assert.equal(problems.length, 6);
  assert.ok(problems.every((p) => p.checkId === "suppress.invalid" && p.severity === "error" && p.location.file === "a.html"));
  assert.deepEqual(problems.map((p) => p.location.line), [1, 2, 3, 4, 5, 6]);
  assert.match(problems[4]!.message, /unknown check ID imagez\.alt/);
  assert.match(problems[0]!.fix.summary, /<!-- seaworthy-ignore check\.id: reason -->/);
});

test("expiry: live through the expiry day, then reported and no longer applied", () => {
  const { suppressions } = parseInlineSuppressions(site("<!-- seaworthy-ignore images.alt: tracked in #12 until 2027-02-01 -->\n<img src=a.png>\n"), KNOWN);
  assert.equal(suppressions[0]!.expires, "2027-02-01");
  const f = [finding("images.alt", "a.html", 2)];
  const onTheDay = applySuppressions(f, suppressions, new Date("2027-02-01T23:59:00Z"));
  assert.equal(onTheDay.findings.length, 0);
  assert.equal(onTheDay.expired.length, 0);
  const after = applySuppressions(f, suppressions, new Date("2027-02-02T00:00:01Z"));
  assert.equal(after.findings.length, 1, "the finding is back");
  assert.equal(after.suppressed.length, 0);
  assert.equal(after.expired.length, 1);
  assert.equal(after.expired[0]!.checkId, "suppress.expired");
  assert.equal(after.expired[0]!.severity, "warning");
  assert.deepEqual([after.expired[0]!.location.file, after.expired[0]!.location.line], ["a.html", 1]);
  assert.match(after.expired[0]!.message, /expired on 2027-02-01: tracked in #12/);
});

test("config suppressions match by file glob and by fingerprint", () => {
  const byGlob = fromConfig([{ check: "links.internal", file: "blog/**", reason: "archive" }], "../seaworthy.config.json");
  const f = [finding("links.internal", "blog/2020/a.html", 4), finding("links.internal", "docs/a.html", 4), finding("images.alt", "blog/b.html", 4)];
  assert.deepEqual(applySuppressions(f, byGlob, NOW).findings.map((x) => x.location.file), ["docs/a.html", "blog/b.html"]);
  const target = finding("links.internal", "docs/a.html", 9, "/gone");
  const byPrint = fromConfig([{ check: "links.internal", fingerprint: target.fingerprint, reason: "known" }], "../seaworthy.config.json");
  const r = applySuppressions([target, finding("links.internal", "docs/a.html", 9, "/other")], byPrint, NOW);
  assert.deepEqual(r.suppressed.map((s) => [s.fingerprint, s.source]), [[target.fingerprint, "config"]]);
  assert.equal(r.findings.length, 1);
});

test("an expired config suppression is reported at the config file", () => {
  const s = fromConfig([{ check: "links.internal", file: "blog/**", reason: "archive", expires: "2026-12-31" }], "../seaworthy.config.json");
  const r = applySuppressions([finding("links.internal", "blog/a.html", 1)], s, NOW);
  assert.equal(r.findings.length, 1);
  assert.equal(r.expired[0]!.location.file, "../seaworthy.config.json");
  assert.equal(r.expired[0]!.location.line, undefined);
});

test("suppressed findings are never silently dropped: they are listed with their reason", () => {
  const s = fromConfig([{ check: "images.alt", file: "a.html", reason: "decorative" }], "c.json");
  const r = applySuppressions([finding("images.alt", "a.html", 3)], s, NOW);
  assert.deepEqual(r.suppressed, [{ checkId: "images.alt", fingerprint: r.suppressed[0]!.fingerprint, file: "a.html", line: 3, reason: "decorative", source: "config" }]);
});
