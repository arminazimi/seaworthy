// The agent loop, end to end: verify, apply the suggested edits, verify again. If an edit were wrong,
// the finding would remain, or a new one would appear.

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { builtInChecks } from "../src/checks/index.js";
import type { Edit, Finding } from "../src/types.js";
import { verifySite } from "../src/verify.js";

const FIXTURES = fileURLToPath(new URL("../../../../fixtures/broken/", import.meta.url));
const NOW = new Date("2027-01-01T00:00:00Z");

/** Applies one text-anchored edit to a site folder: replaces the first occurrence of `find` on the given line. */
export function applyEdit(root: string, edit: Edit): void {
  const path = join(root, ...edit.file.split("/"));
  const lines = readFileSync(path, "utf8").split("\n");
  const line = lines[edit.line - 1];
  assert.ok(line !== undefined && line.includes(edit.find), `${edit.file}:${edit.line}: "${edit.find}" is not on that line any more`);
  lines[edit.line - 1] = line.replace(edit.find, () => edit.replace);
  writeFileSync(path, lines.join("\n"));
}

async function fixLoop(fixture: string, checkIds: string[]): Promise<{ before: Finding[]; after: Finding[]; applied: number }> {
  const root = join(mkdtempSync(join(tmpdir(), "seaworthy-fix-")), "site");
  cpSync(join(FIXTURES, fixture, "site"), root, { recursive: true });
  const checks = builtInChecks.filter((c) => checkIds.includes(c.meta.id));
  const run = async () => (await verifySite({ folder: root, rootLabel: "site", checks, now: NOW })).report.findings;

  const before = await run();
  // Apply from the bottom of each file up, so an edit never moves a line that a later edit relies on.
  const edits = before.flatMap((f) => f.fix.edits).sort((a, b) => (a.file === b.file ? b.line - a.line : a.file < b.file ? -1 : 1));
  const seen = new Set<string>();
  let applied = 0;
  for (const edit of edits) {
    const key = JSON.stringify(edit);
    if (seen.has(key)) continue; // several findings can propose the same edit
    seen.add(key);
    applyEdit(root, edit);
    applied++;
  }
  return { before, after: await run(), applied };
}

test("links.internal: applying the suggested edits fixes the links they target", async () => {
  const { before, after, applied } = await fixLoop("links-internal", ["links.internal"]);
  assert.equal(before.length, 4);
  assert.ok(applied >= 2, `expected at least two edits, got ${applied}`);
  const fixedKeys = new Set(before.filter((f) => f.fix.edits.length > 0).map((f) => f.fingerprint));
  assert.ok(fixedKeys.size >= 2);
  for (const f of after) assert.ok(!fixedKeys.has(f.fingerprint), `${f.message} is still reported after its edit`);
  assert.ok(after.length < before.length);
});

test("assets.missing: applying the suggested edits fixes the references they target", async () => {
  const { before, after } = await fixLoop("assets-missing", ["assets.missing"]);
  assert.ok(before.some((f) => f.fix.edits.length > 0));
  const fixed = new Set(before.filter((f) => f.fix.edits.length > 0).map((f) => f.fingerprint));
  for (const f of after) assert.ok(!fixed.has(f.fingerprint), `${f.message} is still reported after its edit`);
});

test("meta.*: inserting the suggested tags makes the missing-tag findings go away", async () => {
  const ids = ["meta.title", "meta.description", "meta.lang", "meta.viewport", "meta.canonical"];
  const { before, after } = await fixLoop("meta", ids);
  const fixable = before.filter((f) => f.fix.edits.length > 0);
  assert.ok(fixable.length >= 4, "bare.html alone has five missing tags");
  const fixed = new Set(fixable.map((f) => f.fingerprint));
  for (const f of after) assert.ok(!fixed.has(f.fingerprint), `${f.checkId} in ${f.location.file} is still reported after its edit`);
  assert.equal(after.filter((f) => f.location.file === "bare.html").length, 0, "bare.html is fully fixed by the suggested edits");
});

test("html.charset: the suggested tag clears the missing-declaration finding", async () => {
  const { before, after } = await fixLoop("html-charset", ["html.charset"]);
  assert.deepEqual(
    before.map((f) => f.location.file),
    ["late.html", "missing.html"],
  );
  assert.equal(before.find((f) => f.location.file === "missing.html")!.fix.kind, "edit");
  assert.deepEqual(
    after.map((f) => f.location.file),
    ["late.html"],
    "the late declaration needs a manual move",
  );
});

test("social.open-graph: the suggested tags complete the set", async () => {
  const { after } = await fixLoop("social", ["social.open-graph"]);
  assert.deepEqual(after, []);
});

test("social.twitter-card: the suggested edits fix cards whose image exists, and leave pages without a real image to the author", async () => {
  const { after } = await fixLoop("social", ["social.twitter-card"]);
  assert.deepEqual(
    after.map((f) => f.location.file).sort(),
    ["none.html", "partial.html", "twitter-no-image.html"],
  );
  for (const f of after) assert.equal(f.fix.kind, "manual", `${f.location.file} needs a real image URL, not a placeholder`);
});

test("images.dimensions and images.alt: edits from two checks to the same image both apply", async () => {
  const { before, after } = await fixLoop("images", ["images.alt", "images.dimensions"]);
  const first = before.filter((f) => f.location.line === 8);
  assert.deepEqual(first.map((f) => f.checkId).sort(), ["images.alt", "images.dimensions"], "line 8 has both problems");
  assert.ok(before.every((f) => f.fix.edits.length > 0), "every finding, even the multi-line tag, now has an edit");
  assert.deepEqual(after, [], "applying every edit, in any order, leaves nothing");
});

test("names.*: the suggested aria-labels satisfy the checks", async () => {
  const { before, after } = await fixLoop("names", ["names.label", "names.button", "names.link"]);
  assert.ok(before.length >= 8);
  assert.deepEqual(after, []);
});

test("security.*: the suggested edits add noopener and switch to https", async () => {
  const { before, after } = await fixLoop("security", ["security.target-blank", "security.mixed-content"]);
  assert.equal(before.length, 7);
  assert.ok(before.every((f) => f.fix.edits.length > 0));
  assert.deepEqual(after, []);
});

test("a11y.tabindex: the suggested edits restore the natural focus order", async () => {
  const { before, after } = await fixLoop("a11y-tabindex", ["a11y.tabindex"]);
  assert.equal(before.length, 3);
  assert.deepEqual(after, []);
});
