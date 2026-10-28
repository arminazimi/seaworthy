// `seaworthy fix --dry-run`: one unified diff of every plannable edit, no file touched,
// and manual guidance on stderr for findings Seaworthy cannot safely turn into edits.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";

import { EXIT, run } from "../src/cli.js";
import type { Check } from "../src/types.js";

const INDEX = [
  "<!doctype html>",
  '<html lang="en">',
  "<head><title>alpha page</title></head>",
  "<body>",
  "<p>alpha</p>",
  "<p>beta</p>",
  "<p>gamma</p>",
  "<p>delta</p>",
  "<p>epsilon</p>",
  "<p>zeta</p>",
  "<p>eta</p>",
  "</body>",
  "</html>",
].join("\n");
const ABOUT = ["<!doctype html>", '<html lang="en">', "<head><title>about</title></head>", "<body>", "<p>about alpha</p>", "</body>", "</html>"].join("\n");

type One = { file: string; line: number; find: string; replace: string; needsInput?: boolean; kind?: "edit" | "manual"; message: string };

/** A check whose findings are fully described by the test, so diff content is in this file. */
const check = (id: string, severity: Check["meta"]["severity"], ones: One[]): Check => ({
  meta: { id, title: id, severity, needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: () =>
    ones.map((one) => ({
      message: one.message,
      location: { file: one.file, line: one.line, column: 1 },
      fix: {
        kind: one.kind ?? "edit",
        summary: one.kind === "manual" ? `${id} must be fixed by a person` : `replace with ${JSON.stringify(one.replace)}`,
        edits: one.kind === "manual" ? [] : [{ file: one.file, line: one.line, action: "replace" as const, find: one.find, replace: one.replace, ...(one.needsInput ? { needsInput: true } : {}) }],
      },
      key: one.find,
    })),
});

const FIX_CHECKS = [
  check("fix.alpha", "warning", [
    { file: "index.html", line: 2, find: '<html lang="en">', replace: '<html lang="en-GB">', message: "lang is too broad" },
    { file: "index.html", line: 10, find: "<p>zeta</p>", replace: "<p>zeta zeta</p>", message: "zeta repeats" },
    { file: "about.html", line: 5, find: "<p>about alpha</p>", replace: "<p>about alpha,</p>", message: "about page drifts" },
  ]),
  // The same edit as fix.alpha's first one: deduplicated in the diff, counted once.
  check("fix.dupe", "warning", [{ file: "index.html", line: 2, find: '<html lang="en">', replace: '<html lang="en-GB">', message: "same lang problem" }]),
  check("fix.manual", "note", [{ file: "index.html", line: 3, find: "<title>alpha page</title>", replace: "<title>better</title>", kind: "manual", message: "titles are subjective" }]),
  check("fix.input", "note", [{ file: "about.html", line: 6, find: "</body>", replace: "</body> <!-- alt -->", needsInput: true, message: "a person must write the content" }]),
  check("fix.stale", "warning", [{ file: "about.html", line: 4, find: "<p>NOT THERE</p>", replace: "<p>x</p>", message: "the anchor is gone" }]),
];

function snapshot(root: string, out: Map<string, string> = new Map()): Map<string, string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) snapshot(path, out);
    else out.set(path, readFileSync(path, "utf8"));
  }
  return out;
}

const hunks = (diff: string): number => diff.split("\n").filter((l) => l.startsWith("@@ ")).length;

test("fix --dry-run prints one unified diff, changes nothing, and guides the rest to stderr", async (t: TestContext) => {
  const root = makeSiteFixed({ "index.html": INDEX, "about.html": ABOUT });
  const before = snapshot(root);
  const result = await run(["fix", root, "--dry-run"], { checks: FIX_CHECKS });

  assert.equal(result.code, EXIT.ok);

  const diff = result.stdout;
  const files = diff.split("\n").filter((l) => l.startsWith("diff --git "));
  assert.deepEqual(files, ["diff --git a/about.html b/about.html", "diff --git a/index.html b/index.html"], "one patch, both files, sorted");
  assert.equal(hunks(diff), 3);

  // excerpt checks: headers, hunk line numbers, signs
  // Each file's hunks asserted on that file's own slice, so one cannot shadow the other.
  const aboutDiff = diff.slice(0, diff.indexOf("diff --git a/index.html"));
  const indexDiff = diff.slice(diff.indexOf("diff --git a/index.html"));
  assert.ok(aboutDiff.includes("@@ -2,6 +2,6 @@"), `about hunk covers lines 2-7, one edit plus context:\n${diff}`);
  assert.ok(/@@ -1,5 \+1,5 @@/.test(indexDiff), `index hunk covers lines 1-5:\n${diff}`);
  assert.ok(/@@ -7,7 \+7,7 @@/.test(indexDiff), `index hunk covers lines 7-13, around line 10:\n${diff}`);
  assert.ok(indexDiff.includes('-<html lang="en">') && indexDiff.includes('+<html lang="en-GB">'), "the attribute edit is a whole minus line plus a whole plus line");
  assert.ok(diff.includes("-<p>zeta</p>") && diff.includes("+<p>zeta zeta</p>"), "the paragraph edit is a minus/plus pair");
  assert.ok(diff.includes("-<p>about alpha</p>"), "the about edit is in the diff");
  assert.ok(!diff.includes("alt"), "the needs-input edit stays out of the diff");

  // stderr carries the summary and the protecting rails
  assert.match(result.stderr, /^seaworthy: 3 edits in 2 files; 3 findings need manual guidance\n/);
  for (const id of ["fix.manual", "fix.input", "fix.stale"]) assert.ok(result.stderr.includes(id), `${id} is guided manually`);

  // byte-identical files before and after
  const after = snapshot(root);
  assert.deepEqual([...after.keys()], [...before.keys()]);
  for (const [path, content] of before) assert.equal(after.get(path), content, `${path} must be byte-identical`);

  const git = spawnSync("git", ["--version"]);
  if (git.status !== 0 || git.error) {
    t.skip("git is not available, so the diff cannot be check-applied");
    return;
  }
  const patch = join(tmpdir(), `seaworthy-fix-preview-${process.pid}-${Date.now()}.patch`);
  writeFileSync(patch, diff);
  const applied = spawnSync("git", ["apply", "--check", patch], { cwd: root, encoding: "utf8" });
  assert.equal(applied.status, 0, `git apply --check rejects the diff:\n${diff}\nstdout: ${applied.stdout}\nstderr: ${applied.stderr}\n`);
});

test("the printed diff applies cleanly and produces the promised content", async (t: TestContext) => {
  const git = spawnSync("git", ["--version"]);
  if (git.status !== 0 || git.error) return t.skip("git is not available, so nothing to prove by applying");
  const source = { "index.html": INDEX, "about.html": ABOUT };
  const root = makeSiteFixed(source);
  const copy = join(tmpdir(), "seaworthy-fix-apply-" + Date.now());
  mkdirSync(copy, { recursive: true });
  const result = await run(["fix", root, "--dry-run"], { checks: FIX_CHECKS });
  writeFileSync(join(copy, "index.html"), INDEX);
  writeFileSync(join(copy, "about.html"), ABOUT);
  const patch = join(copy, "fix.patch");
  writeFileSync(patch, result.stdout);
  const apply = spawnSync("git", ["apply", patch], { cwd: copy, encoding: "utf8" });
  assert.equal(apply.status, 0, apply.stderr);
  const index = readFileSync(join(copy, "index.html"), "utf8");
  assert.ok(index.includes('<html lang="en-GB">'), "attribute applied");
  assert.ok(index.includes("<p>zeta zeta</p>"), "paragraph applied");
  assert.ok(readFileSync(join(copy, "about.html"), "utf8").includes("<p>about alpha,</p>"), "about applied");
});

test("fix usage errors follow the verify conventions", async () => {
  const root = makeSiteFixed({ "index.html": INDEX });
  assert.equal((await run(["fix", root])).code, EXIT.usage, "no --dry-run is a usage error");
  assert.match((await run(["fix", root])).stderr, /Pass --dry-run/);
  assert.equal((await run(["fix", root, "--bogus"])).code, EXIT.usage);
  assert.equal((await run(["fix", root, "extra", "--dry-run"])).code, EXIT.usage);
  assert.equal((await run(["fix", root, "--dry-run", "--dry-run=1"])).code, EXIT.usage);
  assert.equal((await run(["fix", root, "--config"])).code, EXIT.usage);
  const help = await run(["fix"]);
  assert.equal(help.code, EXIT.ok);
  assert.match(help.stdout, /seaworthy fix/);
});

test("a site with no findings prints nothing to stdout and an all-clear to stderr", async () => {
  const root = makeSiteFixed({ "index.html": INDEX });
  const result = await run(["fix", root, "--dry-run"], { checks: [] });
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stdout, "", "no diff when there are no findings");
  assert.match(result.stderr, /no findings in .*; nothing to fix/);
});

// --- fixture helpers, placed here so the tests stay readable -------------------------------

const made: string[] = [];
function makeSiteFixed(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "seaworthy-fix-dry-"));
  made.push(root);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  return root;
}
process.on("exit", () => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});
