import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BaselineError, applyBaseline, createBaseline, readBaseline, writeBaseline } from "../src/baseline.js";
import { fingerprint } from "../src/engine.js";
import type { Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

const finding = (checkId: string, file: string, line: number, key: string): Finding => ({
  checkId,
  severity: "error",
  message: "m",
  location: { file, line },
  fix: { kind: "manual", summary: "s", edits: [], appliesTo: "built-output" },
  fingerprint: fingerprint(checkId, file, key),
});

const existing = [finding("links.internal", "a.html", 3, "/x"), finding("links.internal", "a.html", 9, "/x"), finding("images.alt", "b.html", 2, "/i.png")];

test("a baseline accepts exactly what it recorded and reports only new findings", () => {
  const baseline = createBaseline(existing);
  assert.deepEqual(baseline.entries.map((e) => [e.checkId, e.file, e.count]), [["links.internal", "a.html", 2], ["images.alt", "b.html", 1]]);
  assert.equal(applyBaseline(existing, baseline).findings.length, 0, "first run after adopting passes");
  const withNew = [...existing, finding("links.internal", "c.html", 1, "/new")];
  const r = applyBaseline(withNew, baseline);
  assert.deepEqual(r.findings.map((f) => f.location.file), ["c.html"]);
  assert.equal(r.baselined, 3);
  assert.equal(r.stale, 0);
});

test("a baselined finding stays baselined when its line moves", () => {
  const baseline = createBaseline(existing);
  const moved = existing.map((f) => ({ ...f, location: { ...f.location, line: f.location.line! + 40 } }));
  assert.equal(applyBaseline(moved, baseline).findings.length, 0);
});

test("counts matter: one more of the same problem is new", () => {
  const baseline = createBaseline(existing);
  const r = applyBaseline([...existing, finding("links.internal", "a.html", 20, "/x")], baseline);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0]!.location.line, 20, "the extra, latest one is reported");
  assert.equal(r.baselined, 3);
});

test("fixed problems are counted as stale so the baseline can be pruned", () => {
  const baseline = createBaseline(existing);
  const r = applyBaseline([existing[2]!], baseline);
  assert.deepEqual([r.findings.length, r.baselined, r.stale], [0, 1, 2]);
});

test("baseline files are deterministic and round-trip", () => {
  const dir = makeSite({ "x.txt": "x" });
  const path = join(dir, "nested", "seaworthy-baseline.json");
  writeBaseline(path, createBaseline([...existing].reverse()));
  const text = readFileSync(path, "utf8");
  writeBaseline(path, createBaseline(existing));
  assert.equal(readFileSync(path, "utf8"), text, "input order does not change the file");
  assert.deepEqual(readBaseline(path), createBaseline(existing));
  assert.ok(text.endsWith("}\n"));
});

test("readBaseline explains what is wrong", () => {
  const dir = makeSite({ "notjson.json": "{", "wrong.json": '{"hello":1}', "old.json": '{"spec":9,"tool":"seaworthy","entries":[]}', "bad.json": '{"spec":0,"tool":"seaworthy","entries":[{"fingerprint":"x","count":0}]}' });
  assert.throws(() => readBaseline(join(dir, "missing.json")), BaselineError);
  assert.throws(() => readBaseline(join(dir, "notjson.json")), /cannot read baseline/);
  assert.throws(() => readBaseline(join(dir, "wrong.json")), /is not a Seaworthy baseline file/);
  assert.throws(() => readBaseline(join(dir, "old.json")), /written for spec 9.*--update-baseline/);
  assert.throws(() => readBaseline(join(dir, "bad.json")), /malformed entry/);
});
