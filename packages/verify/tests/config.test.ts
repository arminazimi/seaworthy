import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, loadConfig, parseConfig, resolveChecks } from "../src/config.js";
import type { Check } from "../src/types.js";
import { makeSite } from "./helpers.js";

const IDS = ["links.internal", "images.alt", "a11y.color-contrast", "a11y.axe"];
const check = (id: string): Check => ({ meta: { id, title: id, severity: "error", needs: ["html"], docs: "https://example.test", standards: [] }, run: () => [] });
const parse = (raw: unknown) => parseConfig(raw, "seaworthy.config.json", IDS);
const problems = (raw: unknown): string => {
  try {
    parse(raw);
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error.message;
  }
  assert.fail("expected the config to be rejected");
};

test("a full config parses", () => {
  const config = parse({
    $schema: "https://example.test/schema.json",
    root: "dist",
    failOn: "warning",
    rendered: true,
    network: false,
    baseline: "seaworthy-baseline.json",
    ignore: ["drafts/**", "404.html"],
    checks: { "links.internal": "warning", "images.alt": "off", "a11y.*": { severity: "note", options: { rules: ["color-contrast"] } } },
    suppressions: [{ check: "links.internal", file: "blog/old.html", reason: "page is archived", expires: "2027-03-01" }, { check: "images.alt", fingerprint: "d6062a0613274944", reason: "decorative" }],
  });
  assert.equal(config.root, "dist");
  assert.equal(config.failOn, "warning");
  assert.deepEqual(config.checks["links.internal"], { off: false, severity: "warning", options: {} });
  assert.deepEqual(config.checks["images.alt"], { off: true, options: {} });
  assert.deepEqual(config.checks["a11y.*"]?.options, { rules: ["color-contrast"] });
  assert.equal(config.suppressions.length, 2);
  assert.deepEqual(config.ignore, ["drafts/**", "404.html"]);
});

test("an empty object is a valid config", () => {
  assert.deepEqual(parse({}), { checks: {}, ignore: [], suppressions: [] });
});

test("errors name the key, the bad value, and the allowed values", () => {
  assert.match(problems({ failOn: "fatal" }), /failOn: got "fatal"; allowed values: error, warning, note, none/);
  assert.match(problems({ rendered: "yes" }), /rendered: must be true or false, got "yes"/);
  assert.match(problems({ checks: { "links.internal": "critical" } }), /checks\."links.internal": got "critical"; use "off", a severity \(error, warning, note\)/);
  assert.match(problems({ checks: { "links.internal": { severity: "huge" } } }), /severity: got "huge"; allowed values: error, warning, note/);
  assert.match(problems({ ignore: "drafts" }), /ignore: must be a list of site-relative globs/);
});

test("typos get a suggestion", () => {
  assert.match(problems({ chekcs: {} }), /unknown key\. Did you mean "checks"\?/);
  assert.match(problems({ checks: { "links.intnal": "off" } }), /matches no check\. Did you mean "links\.internal"\?/);
  assert.match(problems({ checks: { "links.internal": { sevrity: "note" } } }), /unknown key\. Allowed keys: off, severity, options/);
});

test("every problem is listed at once", () => {
  const message = problems({ failOn: "x", rendered: 1, chekcs: {}, suppressions: [{ check: "nope.nope", reason: "" }] });
  assert.match(message, /has 6 problems:/);
  for (const part of ["failOn", "rendered", "chekcs", "suppressions[0].check", "suppressions[0].reason", "suppressions[0]: needs"]) assert.ok(message.includes(part), part);
});

test("suppressions need a reason, a target, and a real date", () => {
  assert.match(problems({ suppressions: [{ check: "links.internal", file: "a.html" }] }), /reason: a reason is required/);
  assert.match(problems({ suppressions: [{ check: "links.internal", reason: "because" }] }), /needs "file" or "fingerprint"/);
  assert.match(problems({ suppressions: [{ check: "links.internal", file: "a.html", reason: "because", expires: "next year" }] }), /expires: must be a date like 2027-03-01/);
  assert.match(problems({ suppressions: [{ check: "links.internal", file: "a.html", reason: "because", expires: "2027-13-45" }] }), /expires/);
  assert.match(problems({ suppressions: [{ check: "links.internal", fingerprint: "xyz", reason: "because" }] }), /fingerprint: must be the 16-character fingerprint/);
});

test("loadConfig: absent default is empty, absent explicit file is an error, bad JSON is explained", () => {
  const empty = makeSite({ "a.txt": "x" });
  assert.deepEqual(loadConfig(empty, undefined, IDS), { config: { checks: {}, ignore: [], suppressions: [] }, file: undefined });
  assert.throws(() => loadConfig(empty, "nope.json", IDS), /config file not found: nope\.json/);
  const bad = makeSite({ "seaworthy.config.json": "{ not json" });
  assert.throws(() => loadConfig(bad, undefined, IDS), /seaworthy\.config\.json is not valid JSON/);
  const ok = makeSite({ "seaworthy.config.json": '{ "failOn": "note" }' });
  const loaded = loadConfig(ok, undefined, IDS);
  assert.equal(loaded.config.failOn, "note");
  assert.ok(loaded.file?.endsWith("seaworthy.config.json"));
});

test("resolveChecks: off, severity, and options", () => {
  const checks = IDS.map(check);
  const resolved = resolveChecks(parse({ checks: { "images.alt": "off", "links.internal": { severity: "warning", options: { max: 3 } } } }), checks);
  assert.deepEqual(resolved.checks.map((c) => c.meta.id), ["links.internal", "a11y.color-contrast", "a11y.axe"]);
  assert.deepEqual(resolved.severity, { "links.internal": "warning" });
  assert.deepEqual(resolved.options, { "links.internal": { max: 3 } });
});

test("resolveChecks: an exact ID beats a prefix, and a longer prefix beats a shorter one", () => {
  const checks = IDS.map(check);
  const ids = (raw: unknown) => resolveChecks(parse(raw), checks).checks.map((c) => c.meta.id);
  assert.deepEqual(ids({ checks: { "a11y.*": "off" } }), ["links.internal", "images.alt"]);
  assert.deepEqual(ids({ checks: { "a11y.*": "off", "a11y.color-contrast": "warning" } }), ["links.internal", "images.alt", "a11y.color-contrast"], "exact ID turns one back on");
  assert.deepEqual(ids({ checks: { "a11y.color-contrast": "off", "a11y.*": "note" } }), ["links.internal", "images.alt", "a11y.axe"], "order in the file does not matter");
  const resolved = resolveChecks(parse({ checks: { "a11y.*": "note", "a11y.color-contrast": "error" } }), checks);
  assert.deepEqual(resolved.severity, { "a11y.color-contrast": "error", "a11y.axe": "note" });
});
