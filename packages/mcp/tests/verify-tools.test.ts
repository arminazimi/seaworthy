// Unit tests for the `verify_site` and `verify_changed` tools: the report they return, the files
// they limit the findings to, and the errors they explain. No server process needed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { builtInChecks, buildSite, reportToJson, resolveBasePath, rootLabel, verifySite } from "@seaworthy/verify";
import type { Check } from "@seaworthy/verify";

import { verifyChangedReport, verifySiteReport } from "../src/verify-tools.js";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A workspace folder with the given files, cleaned up after the test file. */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-mcp-"));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const PAGE = '<!doctype html><html lang="en"><head><title>Page</title></head><body><main><h1>Page</h1><img src="a.png"></main></body></html>';

/** One check that flags every page, so a test can count the findings per file. */
const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) =>
    [...ctx.site.pages.values()]
      .filter((page) => page.source.includes("<img src="))
      .map((page) => ({ message: "no alt", location: { file: page.file, line: 1 }, fix: { kind: "manual" as const, summary: "add alt" }, key: page.url })),
};

const reportSchema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../spec/report/v0.schema.json", import.meta.url)), "utf8"));
const Ajv = Ajv2020 as unknown as typeof Ajv2020.default;
const validator = new Ajv({ strict: true, allErrors: true }).compile(reportSchema);

/** Schema violations of a report, or an empty list when it conforms. */
function reportErrors(value: unknown): string[] {
  return validator(value) ? [] : validator.errors!.map((error) => `${error.instancePath} ${error.message}`);
}

interface Report {
  root: string;
  summary: { findings: number; changedFiles?: number };
  findings: Array<{ checkId: string; location: { file: string } }>;
}

const parse = (text: string): Report => JSON.parse(text) as Report;

test("verify_site returns the report of the whole site as JSON", async () => {
  const cwd = workspace({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  const text = await verifySiteReport({ site: "dist" }, { cwd, checks: [imgCheck] });
  const report = parse(text);
  assert.deepEqual(reportErrors(report), [], "the report matches the report schema");
  assert.equal(report.root, "dist");
  assert.deepEqual(report.findings.map((finding) => finding.location.file), ["a.html", "b.html"]);
  assert.equal(report.summary.findings, 2);
  assert.equal("changedFiles" in report.summary, false, "the whole site is reported, not a changed set");
});

test("verify_site finds the built folder when none is given", async () => {
  const cwd = workspace({ "dist/index.html": PAGE, "out/index.html": PAGE });
  const report = parse(await verifySiteReport({}, { cwd, checks: [imgCheck] }));
  assert.equal(report.root, "dist", "the first default folder that exists wins");

  const built = workspace({ "out/index.html": PAGE });
  assert.equal(parse(await verifySiteReport({}, { cwd: built, checks: [imgCheck] })).root, "out");
});

test("verify_site explains that the site was not built", async () => {
  const cwd = workspace({ "README.md": "x" });
  await assert.rejects(() => verifySiteReport({}, { cwd, checks: [imgCheck] }), /no built site found.*dist, build, out, public, _site, site/);
  await assert.rejects(() => verifySiteReport({ site: "missing" }, { cwd, checks: [imgCheck] }), /no folder missing/);
  await assert.rejects(() => verifySiteReport({ site: "README.md" }, { cwd, checks: [imgCheck] }), /not a folder/);
});

test("verify_site returns what the verify API returns for the same site", async () => {
  const cwd = workspace({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  const folder = join(cwd, "dist");
  const base = resolveBasePath({ folder });
  const site = buildSite(folder, base.basePath === "/" ? {} : { basePath: base.basePath });
  const { report } = await verifySite({ folder, site, rootLabel: rootLabel(cwd, folder), checks: [imgCheck] });
  assert.equal(await verifySiteReport({ site: "dist" }, { cwd, checks: [imgCheck] }), reportToJson(report));
});

test("verify_changed reports only the findings in the files that differ from the ref", async () => {
  const cwd = workspace({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "one");
  writeFileSync(join(cwd, "dist", "a.html"), PAGE + "<p>edited</p>");

  const report = parse(await verifyChangedReport({ site: "dist", since: "HEAD" }, { cwd, checks: [imgCheck] }));
  assert.deepEqual(report.findings.map((finding) => finding.location.file), ["a.html"]);
  assert.equal(report.summary.changedFiles, 1);

  await assert.rejects(() => verifyChangedReport({ site: "dist", since: "no-such-ref" }, { cwd, checks: [imgCheck] }), /git failed/);
});

test("verify_changed without a ref compares with the last run", async () => {
  const cwd = workspace({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  const first = parse(await verifyChangedReport({ site: "dist" }, { cwd, checks: [imgCheck] }));
  assert.deepEqual(first.findings.map((finding) => finding.location.file), ["a.html", "b.html"], "the first run has no history, so everything changed");

  const idle = parse(await verifyChangedReport({ site: "dist" }, { cwd, checks: [imgCheck] }));
  assert.deepEqual(idle.findings, [], "nothing changed, nothing to report");
  assert.equal(idle.summary.changedFiles, 0);

  writeFileSync(join(cwd, "dist", "b.html"), PAGE + "<p>edited</p>");
  const edited = parse(await verifyChangedReport({ site: "dist" }, { cwd, checks: [imgCheck] }));
  assert.deepEqual(edited.findings.map((finding) => finding.location.file), ["b.html"]);
});

test("verify_site and verify_changed read the config of the workspace", async () => {
  const cwd = workspace({
    "dist/a.html": PAGE,
    "seaworthy.config.json": JSON.stringify({ checks: { "images.alt": "off" } }),
  });
  const off = parse(await verifySiteReport({ site: "dist" }, { cwd, checks: [imgCheck] }));
  assert.deepEqual(off.findings, [], "the config turns the check off");

  const all = parse(await verifySiteReport({ site: "dist" }, { cwd, checks: builtInChecks }));
  assert.ok(all.findings.length > 0, "without the config the built-in checks report the missing alt");
});
