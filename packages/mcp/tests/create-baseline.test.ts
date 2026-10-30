// Unit tests for `create_baseline`: what the tool writes must be the same document the CLI's
// `--update-baseline` records — verify's own baseline, read back with verify's own reader — so
// the parity check runs the built CLI in a temp workspace and compares the two files. Without a
// path nothing is written. Everything stays offline and in a temp folder, cleaned up after.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { readBaseline, REPORT_SPEC_VERSION } from "@seaworthy/verify";

import { CREATE_BASELINE_DESCRIPTION, CREATE_BASELINE_NAME, createBaselineReport } from "../src/create-baseline.js";
import type { CreateBaselineOutput } from "../src/create-baseline.js";

// The built verify CLI, for the parity run: `<pkg>/dist/tests` → `packages/verify/dist/src/cli.js`.
const CLI = fileURLToPath(new URL("../../../verify/dist/src/cli.js", import.meta.url));
const SKIP_CLI = existsSync(CLI) ? false : "built verify CLI missing (dist/src): run `npm run build` first";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const PAGE = '<!doctype html><html lang="en"><head><title>Page</title></head><body><main><h1>Page</h1><img src="a.png"><p>Text without a caption.</p></main></body></html>';

/** A workspace folder holding a built site with a finding (an img without alt), cleaned up after the test file. */
function siteWorkspace(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-mcp-baseline-"));
  made.push(dir);
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.html"), PAGE);
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

async function runTool(cwd: string, input: { site?: string; path?: string }): Promise<CreateBaselineOutput> {
  return JSON.parse(await createBaselineReport(input, { cwd })) as CreateBaselineOutput;
}

test("the tool name and description say plainly what gets written and where", () => {
  assert.equal(CREATE_BASELINE_NAME, "create_baseline");
  assert.match(CREATE_BASELINE_DESCRIPTION, /--update-baseline/);
  assert.match(CREATE_BASELINE_DESCRIPTION, /fingerprints with counts/);
  assert.match(CREATE_BASELINE_DESCRIPTION, /never touches the site/i);
});

test("with a path the tool writes the baseline the verify API reads back, keyed by fingerprint and count", async () => {
  const cwd = siteWorkspace();
  const output = await runTool(cwd, { site: "dist", path: "seaworthy-baseline.json" });
  const target = join(cwd, "seaworthy-baseline.json");
  assert.equal(output.written, true);
  assert.equal(output.path, "seaworthy-baseline.json");
  assert.ok(output.findings >= 1, "the page above must produce a finding to record");
  assert.equal(output.entries, output.baseline.entries.length);
  assert.equal(output.baseline.spec, REPORT_SPEC_VERSION);
  assert.equal(output.baseline.tool, "seaworthy");

  // A file `verify --baseline` accepts: readBaseline parses and validates it.
  const readBack = readBaseline(target);
  assert.deepEqual(readBack, JSON.parse(readFileSync(target, "utf8")));
  assert.deepEqual(readBack, output.baseline);
  // Fingerprints, not line numbers: entries carry checkId, file, fingerprint, count.
  for (const entry of readBack.entries) {
    assert.deepEqual(Object.keys(entry), ["checkId", "file", "fingerprint", "count"]);
    assert.match(entry.fingerprint, /^[0-9a-f]{16}$/);
    assert.ok(Number.isInteger(entry.count) && entry.count >= 1);
  }
});

test("the recorded baseline equals what `seaworthy verify --update-baseline` writes for the same site", { skip: SKIP_CLI }, async () => {
  const cwd = siteWorkspace();
  const output = await runTool(cwd, { site: "dist", path: "from-tool.json" });
  execFileSync(process.execPath, [CLI, "verify", "dist", "--update-baseline", "from-cli.json"], { cwd, encoding: "utf8" });
  const cli = readBaseline(join(cwd, "from-cli.json"));
  assert.deepEqual(cli, output.baseline, "the tool and the CLI must record the same fingerprints and counts");
});

test("without a path nothing is written; the result carries the document and the default target", async () => {
  const cwd = siteWorkspace();
  const output = await runTool(cwd, { site: "dist" });
  assert.equal(output.written, false);
  assert.equal(output.path, "seaworthy-baseline.json", "the default is init's baseline file name");
  assert.equal(existsSync(join(cwd, "seaworthy-baseline.json")), false, "a call without a path writes nothing");
  assert.ok(output.baseline.entries.length >= 1);
});

test("without a path the config's baseline key decides the suggested target", async () => {
  const cwd = siteWorkspace({ "seaworthy.config.json": JSON.stringify({ baseline: "accepted/seaworthy-baseline.json" }) + "\n" });
  const output = await runTool(cwd, {});
  assert.equal(output.written, false);
  assert.equal(output.path, "accepted/seaworthy-baseline.json");
  assert.equal(existsSync(join(cwd, "accepted", "seaworthy-baseline.json")), false);
});

test("an empty path is refused, and so is a missing site folder", async () => {
  const cwd = siteWorkspace();
  await assert.rejects(() => createBaselineReport({ site: "dist", path: "  " }, { cwd }), /must name a file/);
  await assert.rejects(() => createBaselineReport({ site: "nope" }, { cwd }), /no folder nope/);
});
