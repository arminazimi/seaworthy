// `seaworthy verify --markdown <paths...>`: explicit Markdown sources for the md.* checks,
// for README files and docs/ folders that live outside the built site folder.

import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT, run } from "../src/cli.js";
import { mdLinks } from "../src/checks/md-links.js";
import { makeSite } from "./helpers.js";

const PAGE = '<!doctype html>\n<html lang="en"><head><title>t</title></head><body>ok</body></html>\n';
const BROKEN = "See [the draft](notes/draft.md).\n";

const json = (result: { stdout: string }): any => JSON.parse(result.stdout);

test("--markdown verifies a Markdown file outside the built folder, with a cwd-relative finding path", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "README.md": BROKEN });
  const result = await run(["verify", "dist", "--format", "json", "--markdown", "README.md"], { cwd, checks: [mdLinks] });
  assert.equal(result.code, EXIT.findings);
  const report = json(result);
  assert.deepEqual(report.findings.map((f: any) => [f.checkId, f.location.file, f.location.line]), [["md.links", "README.md", 1]]);
  assert.equal(report.root, "dist");
  assert.ok(!result.stdout.includes(cwd), "no absolute path in the report");
});

test("--markdown walks a directory argument", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "docs/guide.md": BROKEN, "docs/notes.txt": "not markdown" });
  const result = await run(["verify", "dist", "--format", "json", "--markdown", "docs"], { cwd, checks: [mdLinks] });
  assert.deepEqual(json(result).findings.map((f: any) => f.location.file), ["docs/guide.md"]);
});

test("links between the named files resolve; without --markdown the same run reports nothing", async () => {
  const files = { "dist/index.html": PAGE, "README.md": "[Guide](docs/guide.md)\n", "docs/guide.md": "# Guide\n" };
  const cwd = makeSite(files);
  const named = await run(["verify", "dist", "--format", "json", "--markdown", "README.md", "docs"], { cwd, checks: [mdLinks] });
  assert.equal(named.code, EXIT.ok, named.stdout);
  assert.deepEqual(json(named).findings, []);
  const plain = await run(["verify", "dist", "--format", "json"], { cwd, checks: [mdLinks] });
  assert.equal(plain.code, EXIT.ok);
  assert.deepEqual(json(plain).findings, [], "Markdown outside the built folder stays unseen without the flag, as before");
});

test("--markdown paths combine across occurrences and repeat no findings when a file is named twice", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "README.md": BROKEN, "docs/guide.md": BROKEN });
  const result = await run(["verify", "dist", "--format", "json", "--markdown", "README.md", "README.md", "--markdown", "docs"], { cwd, checks: [mdLinks] });
  assert.deepEqual(json(result).findings.map((f: any) => f.location.file), ["README.md", "docs/guide.md"]);
});

test("a directory holding no Markdown is not an error", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "assets/logo.svg": "<svg/>" });
  const result = await run(["verify", "dist", "--format", "json", "--markdown", "assets"], { cwd, checks: [mdLinks] });
  assert.equal(result.code, EXIT.ok, result.stderr);
  assert.deepEqual(json(result).findings, []);
});

test("missing paths, non-Markdown files, and an empty list are usage errors", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE, "styles.css": "body{}" });
  for (const argv of [
    ["verify", "dist", "--markdown", "nope.md"],
    ["verify", "dist", "--markdown", "styles.css"],
    ["verify", "dist", "--markdown"],
    ["verify", "dist", "--markdown", "--format", "json"],
  ]) {
    const result = await run(argv, { cwd, checks: [mdLinks] });
    assert.equal(result.code, EXIT.usage, argv.join(" "));
    assert.match(result.stderr, /^seaworthy: --markdown\b/);
    assert.equal(result.stdout, "");
  }
});
