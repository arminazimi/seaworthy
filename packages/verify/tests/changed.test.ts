import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { CACHE_FILE, ChangedError, changedSinceLastRun, changedSinceRef } from "../src/changed.js";
import { EXIT, run } from "../src/cli.js";
import { buildSite } from "../src/site.js";
import type { Check } from "../src/types.js";
import { makeSite, reportErrors } from "./helpers.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const PAGE = '<!doctype html><title>t</title><img src="a.png">';
const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) => [...ctx.site.pages.values()].filter((p) => p.source.includes("<img src=")).map((p) => ({ message: "no alt", location: { file: p.file, line: 1 }, fix: { kind: "manual" as const, summary: "add alt" }, key: p.url })),
};

test("the cache mode treats the first run as everything changed, then only what differs", () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "dist/a.html": PAGE, "dist/css/site.css": "a{}" });
  const root = join(cwd, "dist");
  const first = changedSinceLastRun(buildSite(root), cwd, "dist");
  assert.deepEqual([...first.changed.files].sort(), ["a.html", "css/site.css", "index.html"]);
  first.save();
  assert.ok(existsSync(join(cwd, CACHE_FILE)));

  const same = changedSinceLastRun(buildSite(root), cwd, "dist");
  assert.equal(same.changed.files.size, 0, "nothing changed");

  writeFileSync(join(root, "a.html"), PAGE + "<p>edited</p>");
  writeFileSync(join(root, "new.html"), PAGE);
  const next = changedSinceLastRun(buildSite(root), cwd, "dist");
  assert.deepEqual([...next.changed.files].sort(), ["a.html", "new.html"]);
});

test("the cache is per folder and a damaged cache means everything changed", () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "out/index.html": PAGE });
  changedSinceLastRun(buildSite(join(cwd, "dist")), cwd, "dist").save();
  assert.equal(changedSinceLastRun(buildSite(join(cwd, "out")), cwd, "out").changed.files.size, 1, "a different folder has no history");
  writeFileSync(join(cwd, CACHE_FILE), "{ not json");
  assert.equal(changedSinceLastRun(buildSite(join(cwd, "dist")), cwd, "dist").changed.files.size, 1);
});

test("git mode lists files that differ from the ref, plus untracked files, relative to the site folder", () => {
  const repo = makeSite({ "README.md": "x", "docs/index.html": PAGE, "docs/keep.html": PAGE, "docs/sub/deep.html": PAGE, "other/ignored.html": PAGE });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "one");
  writeFileSync(join(repo, "docs", "index.html"), PAGE + "<p>edited</p>");
  writeFileSync(join(repo, "docs", "sub", "deep.html"), PAGE + "<p>edited</p>");
  writeFileSync(join(repo, "other", "ignored.html"), PAGE + "<p>edited outside the site</p>");
  mkdirSync(join(repo, "docs", "fresh"));
  writeFileSync(join(repo, "docs", "fresh", "new.html"), PAGE);

  const changed = changedSinceRef(join(repo, "docs"), "HEAD");
  assert.equal(changed.mode, "git");
  assert.deepEqual([...changed.files].sort(), ["fresh/new.html", "index.html", "sub/deep.html"]);
  const fromSub = changedSinceRef(join(repo, "docs", "sub"), "HEAD");
  assert.deepEqual([...fromSub.files], ["deep.html"], "paths are relative to the folder given");
});

test("git mode explains a bad ref or a folder outside a repository", () => {
  const repo = makeSite({ "docs/index.html": PAGE });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "one");
  assert.throws(() => changedSinceRef(join(repo, "docs"), "no-such-ref"), ChangedError);
  assert.throws(() => changedSinceRef(join(repo, "docs"), "--output=x"), /is not a git ref/);
  assert.throws(() => changedSinceRef(makeSite({ "a.html": PAGE }), "HEAD"), ChangedError);
});

test("--changed through the CLI: first run reports all, an unchanged rerun reports nothing, an edit reports only that file", async () => {
  const cwd = makeSite({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  const verify = async (...extra: string[]) => run(["verify", "dist", "--format", "json", ...extra], { cwd, checks: [imgCheck] });

  const first = await verify("--changed");
  assert.equal(first.code, EXIT.findings);
  const firstReport = JSON.parse(first.stdout);
  assert.deepEqual(firstReport.findings.map((f: { location: { file: string } }) => f.location.file), ["a.html", "b.html"]);
  assert.equal(firstReport.summary.changedFiles, 2);
  assert.deepEqual(reportErrors(firstReport), []);

  const idle = await verify("--changed");
  assert.equal(idle.code, EXIT.ok, "nothing changed, nothing to report");
  assert.equal(JSON.parse(idle.stdout).summary.changedFiles, 0);

  writeFileSync(join(cwd, "dist", "b.html"), PAGE + "<p>edited</p>");
  const edited = JSON.parse((await verify("--changed")).stdout);
  assert.deepEqual(edited.findings.map((f: { location: { file: string } }) => f.location.file), ["b.html"]);

  const everything = JSON.parse((await verify()).stdout);
  assert.equal(everything.findings.length, 2, "without --changed the whole site is reported");
  assert.equal("changedFiles" in everything.summary, false);
});

test("--changed-since through the CLI reports only files that differ from the ref", async () => {
  const repo = makeSite({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "one");
  writeFileSync(join(repo, "dist", "a.html"), PAGE + "<p>edited</p>");
  const result = await run(["verify", "dist", "--changed-since", "HEAD", "--format", "json"], { cwd: repo, checks: [imgCheck] });
  assert.deepEqual(JSON.parse(result.stdout).findings.map((f: { location: { file: string } }) => f.location.file), ["a.html"]);
  const bad = await run(["verify", "dist", "--changed-since", "nope"], { cwd: repo, checks: [imgCheck] });
  assert.equal(bad.code, EXIT.usage);
  assert.match(bad.stderr, /git failed/);
});

test("--changed flag mistakes are usage errors", async () => {
  const cwd = makeSite({ "dist/a.html": PAGE });
  for (const extra of [["--changed", "--changed-since", "HEAD"], ["--changed", "--update-baseline", "b.json"], ["--changed-since", "HEAD", "--update-baseline", "b.json"], ["--changed-since"]]) {
    const result = await run(["verify", "dist", ...extra], { cwd, checks: [imgCheck] });
    assert.equal(result.code, EXIT.usage, extra.join(" "));
  }
});

test("baseline entries for unchanged files are not called stale under --changed", async () => {
  const cwd = makeSite({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  await run(["verify", "dist", "--update-baseline", "b.json"], { cwd, checks: [imgCheck] });
  await run(["verify", "dist", "--changed", "--baseline", "b.json"], { cwd, checks: [imgCheck] });
  writeFileSync(join(cwd, "dist", "a.html"), PAGE + "<p>edited</p>");
  const report = JSON.parse((await run(["verify", "dist", "--changed", "--baseline", "b.json", "--format", "json"], { cwd, checks: [imgCheck] })).stdout);
  assert.deepEqual([report.summary.baselined, report.summary.baselineStale, report.findings.length], [2, 0, 0]);
  assert.ok(readFileSync(join(cwd, "b.json"), "utf8").includes("images.alt"));
});
