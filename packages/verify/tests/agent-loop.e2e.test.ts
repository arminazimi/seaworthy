// The loop an agent actually runs, end to end and through the built binary: break a copy of a clean
// fixture, verify, apply the fix hint from the report, verify again, and see it clean. cli.test.ts
// proves the CLI's contract with synthetic checks and fix-loop.test.ts proves the engine's edits
// in process; this proves the two meet: a real `seaworthy verify` that names the planted problem at
// its real location carries an edit that, applied, turns the exit code from 1 back to 0.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { EXIT } from "../src/cli.js";
import type { Edit, Report } from "../src/types.js";
import { reportErrors } from "./helpers.js";

// packages/verify/dist/tests/agent-loop.e2e.test.js: the binary is the build's own CLI entry
// (dist/src/cli.js, the file `bin` points at), and the fixture is the repository's, read-only.
const BIN = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const CLEAN_SITE = fileURLToPath(new URL("../../../../fixtures/clean/minimal/site/", import.meta.url));

const workspaces: string[] = [];
after(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/**
 * One run of the real binary over `site` inside cwd, as JSON.
 * `--no-history` keeps the loop hermetic: without it the CLI would add its run-history folder next to
 * the site, which other suites test and this one must not trip over while asserting nothing else moved.
 */
function verify(cwd: string): { code: number; stdout: string; stderr: string } {
  const spawned = spawnSync(process.execPath, [BIN, "verify", "site", "--format", "json", "--no-history"], { cwd, encoding: "utf8" });
  assert.equal(spawned.error, undefined, "the CLI process must start");
  if (spawned.status === null) assert.fail("the CLI must exit on its own, not on a signal");
  return { code: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
}

/** Every file under root as relative path → contents, so a test can prove only the intended file moved. */
function snapshot(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(root, path), readFileSync(path));
    }
  };
  walk(root);
  return files;
}

/** Applies one text-anchored edit the way an agent would: the anchor must sit on the named line. */
function applyEdit(root: string, edit: Edit): void {
  const path = join(root, ...edit.file.split("/"));
  const lines = readFileSync(path, "utf8").split("\n");
  const line = lines[edit.line - 1];
  assert.ok(line !== undefined && line.includes(edit.find), `${edit.file}:${edit.line}: "${edit.find}" is not on that line`);
  lines[edit.line - 1] = line.replace(edit.find, () => edit.replace);
  writeFileSync(path, lines.join("\n"));
}

test("break, verify, fix, verify clean: the whole agent loop through the real CLI", () => {
  // A throwaway copy of the clean fixture; the tracked fixture is only ever read.
  const workspace = mkdtempSync(join(tmpdir(), "seaworthy-agent-loop-"));
  workspaces.push(workspace);
  const site = join(workspace, "site");
  cpSync(CLEAN_SITE, site, { recursive: true });
  writeFileSync(join(workspace, "notes.md"), "A file beside the site that the loop must never touch.\n");

  // Break it in a known way: delete the language declaration from one page, at line 2.
  const pristine = readFileSync(join(CLEAN_SITE, "index.html"), "utf8");
  assert.equal(pristine.split('<html lang="en">').length - 1, 1, "the clean fixture declares its language once, on <html>");
  const broken = pristine.replace('<html lang="en">', "<html>");
  assert.equal(broken.split("\n")[1], "<html>", "the break lands on line 2, where the finding is expected");
  const index = join(site, "index.html");
  writeFileSync(index, broken);
  const before = snapshot(workspace);

  // Verify: the shipped CLI reports the planted problem, and the run fails with the findings code.
  const first = verify(workspace);
  assert.equal(first.code, EXIT.findings, "an error-severity finding fails the run");
  const report = JSON.parse(first.stdout) as Report;
  assert.deepEqual(reportErrors(report), [], "the broken run's report validates against the schema");
  assert.equal(report.root, "site");
  assert.deepEqual(report.errors, [], "no check crashed");
  assert.ok(!first.stdout.includes(workspace), "no absolute path of the temp folder in the report");
  assert.equal(report.findings.length, 1, `expected exactly the planted finding, got ${JSON.stringify(report.findings.map((f) => f.checkId))}`);
  const finding = report.findings[0]!;
  assert.equal(finding.checkId, "meta.lang");
  assert.deepEqual(finding.location, { file: "index.html", line: 2, column: 1 });
  assert.equal(finding.severity, "error");

  // The fix hint is actionable: one edit, anchored on the broken line, with a summary that says what to do.
  assert.equal(finding.fix.kind, "edit");
  assert.equal(finding.fix.edits.length, 1);
  const [edit] = finding.fix.edits;
  assert.ok(edit !== undefined, "the finding carries its edit");
  assert.deepEqual({ file: edit.file, line: edit.line, find: edit.find }, { file: "index.html", line: 2, find: "<html" });
  assert.match(finding.fix.summary, /lang/);

  // The report JSON is stable: reading the same site twice answers byte for byte the same.
  const second = verify(workspace);
  assert.deepEqual(second, first, "the second run returns identical output");

  // Apply the hint as an agent would. It is exactly the inverse of the break.
  applyEdit(site, edit);
  assert.equal(readFileSync(index, "utf8"), pristine, "the fix hint restores the page byte for byte");

  // Verify again: the same real binary now says the site is clean, and exits 0.
  const third = verify(workspace);
  assert.equal(third.code, EXIT.ok, "a fixed site passes the CLI that just failed it");
  const fixed = JSON.parse(third.stdout) as Report;
  assert.deepEqual(fixed.findings, [], "nothing is left to report");
  assert.deepEqual(reportErrors(fixed), [], "the clean run's report validates against the schema");

  // Nothing outside the intended edit moved: no stray reports, no history folder, every other file
  // byte-identical. The tracked fixtures live outside this workspace and were only ever read.
  assert.ok(!existsSync(join(workspace, ".seaworthy")), "--no-history kept the workspace free of a history folder");
  const afterFiles = snapshot(workspace);
  assert.deepEqual([...afterFiles.keys()].sort(), [...before.keys()].sort(), "the loop created and deleted no files");
  for (const [path, contents] of before) {
    if (path === join("site", "index.html")) continue; // the page this test breaks and fixes on purpose
    assert.deepEqual(afterFiles.get(path), contents, `${path} must be byte-identical`);
  }
});
