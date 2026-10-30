// Unit tests for the `diff_reports` tool: the diff of two stored runs of the same site, the
// errors a damaged or missing report explains, and the registered server surface. Everything runs
// offline against temp folders; the comparison itself is verify's (this file asserts the adapter
// stays faithful to it, not that diffing works — packages/verify/tests/diff.test.ts owns that).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { REPORT_SPEC_VERSION } from "@seaworthy/verify";
import type { Check, Finding, Report } from "@seaworthy/verify";

import { DIFF_REPORTS_DESCRIPTION, DIFF_REPORTS_NAME, diffReportsJson } from "../src/diff-reports.js";
import { createServer } from "../src/server.js";
import { verifySiteReport } from "../src/verify-tools.js";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A workspace folder with the given files, cleaned up after the test file. */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-mcp-diff-"));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

/** One check that flags every page carrying the marker, keyed per page, so counts are exact. */
const markerCheck: Check = {
  meta: { id: "x.marker", title: "page carries the marker", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) =>
    [...ctx.site.pages.values()]
      .filter((page) => page.source.includes("broken"))
      .map((page) => ({ message: "has the marker", location: { file: page.file, line: 1 }, fix: { kind: "manual" as const, summary: "remove the marker" }, key: page.url })),
};

const BAD = (title: string): string => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>broken</main></body></html>`;
const GOOD = (title: string): string => BAD(title).replace("broken", "");

/**
 * A workspace holding two report files: run one flagged a.html and b.html; run two fixed b.html
 * and gained c.html, so the diff is one new, one fixed, one unchanged, both roots "dist".
 */
async function twoRuns(): Promise<string> {
  const cwd = workspace({ "dist/a.html": BAD("A"), "dist/b.html": BAD("B") });
  writeFileSync(join(cwd, "before.json"), await verifySiteReport({ site: "dist" }, { cwd, checks: [markerCheck] }));
  writeFileSync(join(cwd, "dist/b.html"), GOOD("B"));
  writeFileSync(join(cwd, "dist/c.html"), BAD("C"));
  writeFileSync(join(cwd, "after.json"), await verifySiteReport({ site: "dist" }, { cwd, checks: [markerCheck] }));
  return cwd;
}

interface DiffJson {
  spec: number;
  tool: { name: string; version: string };
  before: { root: string; findings: number };
  after: { root: string; findings: number };
  summary: { new: number; fixed: number; unchanged: number };
  new: Finding[];
  fixed: Finding[];
  unchanged: Finding[];
}

test("diff_reports compares two runs of the same site into new, fixed, and unchanged", async () => {
  const cwd = await twoRuns();
  const diff = JSON.parse(diffReportsJson({ before: "before.json", after: "after.json" }, { cwd })) as DiffJson;
  assert.equal(diff.spec, REPORT_SPEC_VERSION);
  assert.deepEqual(diff.tool.name, "seaworthy");
  assert.deepEqual(diff.before, { root: "dist", findings: 2 });
  assert.deepEqual(diff.after, { root: "dist", findings: 2 });
  assert.deepEqual(diff.summary, { new: 1, fixed: 1, unchanged: 1 });
  assert.deepEqual(diff.new.map((f) => f.location.file), ["c.html"]);
  assert.deepEqual(diff.fixed.map((f) => f.location.file), ["b.html"]);
  assert.deepEqual(diff.unchanged.map((f) => f.location.file), ["a.html"]);
});

test("diff_reports JSON is deterministic: fixed key order, byte-identical across calls", async () => {
  const cwd = await twoRuns();
  const input = { before: "before.json", after: "after.json" };
  const first = diffReportsJson(input, { cwd });
  assert.equal(diffReportsJson(input, { cwd }), first, "two calls on the same files return the same bytes");
  assert.ok(first.endsWith("\n"));
  assert.deepEqual(
    Object.keys(JSON.parse(first) as Record<string, unknown>),
    ["spec", "tool", "before", "after", "summary", "new", "fixed", "unchanged"],
    "key order is part of the contract",
  );
});

test("diff_reports explains a missing or damaged report instead of guessing", async () => {
  const cwd = await twoRuns();
  const input = { before: "before.json", after: "no-such.json" };
  assert.throws(() => diffReportsJson(input, { cwd }), /cannot read report.*no-such\.json/i);

  writeFileSync(join(cwd, "foreign.json"), JSON.stringify({ hello: "world" }));
  assert.throws(() => diffReportsJson({ before: "foreign.json", after: "after.json" }, { cwd }), /not a Seaworthy report file/);

  writeFileSync(join(cwd, "truncated.json"), '{"spec": 0, "tool": {"name": "seawor');
  assert.throws(() => diffReportsJson({ before: "truncated.json", after: "after.json" }, { cwd }), /cannot read report/);

  const report = JSON.parse(readFileSync(join(cwd, "before.json"), "utf8")) as Report;
  report.findings[0] = {} as Finding;
  writeFileSync(join(cwd, "malformed.json"), JSON.stringify(report));
  assert.throws(() => diffReportsJson({ before: "malformed.json", after: "after.json" }, { cwd }), /malformed finding/);

  const wrongSpec = JSON.parse(readFileSync(join(cwd, "before.json"), "utf8")) as { spec: number };
  wrongSpec.spec = REPORT_SPEC_VERSION + 99;
  writeFileSync(join(cwd, "future.json"), JSON.stringify(wrongSpec));
  assert.throws(() => diffReportsJson({ before: "future.json", after: "after.json" }, { cwd }), /written for spec/);
});

test("the server registers diff_reports and answers calls over the MCP surface", async () => {
  const cwd = await twoRuns();
  const server = createServer({ cwd });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "diff-reports-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["diff_reports", "list_checks", "verify_changed", "verify_site"],
    );
    assert.equal(listed.tools.find((tool) => tool.name === DIFF_REPORTS_NAME)?.description, DIFF_REPORTS_DESCRIPTION);

    const result = await client.callTool({ name: DIFF_REPORTS_NAME, arguments: { before: "before.json", after: "after.json" } });
    assert.equal(result.isError, undefined);
    const diff = JSON.parse((result.content as [{ type: string; text: string }])[0]!.text) as DiffJson;
    assert.deepEqual(diff.summary, { new: 1, fixed: 1, unchanged: 1 });

    const broken = await client.callTool({ name: DIFF_REPORTS_NAME, arguments: { before: "before.json", after: "no-such.json" } });
    assert.equal(broken.isError, true, "a missing run is a clean tool error, not invented data");
    assert.match((broken.content as [{ type: string; text: string }])[0]!.text, /cannot read report/i);

    const unknown = await client.callTool({ name: "diff_reports_but_not", arguments: {} });
    assert.equal(unknown.isError, true);
    assert.match((unknown.content as [{ type: string; text: string }])[0]!.text, /not found/i);
  } finally {
    await client.close();
    await server.close();
  }
});
