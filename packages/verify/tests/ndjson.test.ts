import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createBaseline } from "../src/baseline.js";
import { fingerprint } from "../src/engine.js";
import { run } from "../src/cli.js";
import { verifySite } from "../src/verify.js";
import type { Check, Finding } from "../src/types.js";
import { EXIT } from "../src/cli.js";
import { makeSite, reportErrors, sarifErrors } from "./helpers.js";

const PAGE = '<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body><a href="/missing.html">x</a></body></html>\n';

const check = (id: string, severity: "error" | "warning" | "note", drafts: Exclude<Check["run"], undefined>): Check => ({
  meta: { id, title: `a ${id}`, severity, needs: ["html"], docs: `https://example.test/${id}`, standards: [] },
  run: drafts,
});

// Two findings on two files, yielded in site order, in a plain sync iterable.
const xErr: Check = check("x.err", "error", (ctx) => [...ctx.site.pages.values()].map((page) => ({ message: `err on ${page.url}`, location: { file: page.file, line: 3, column: 7 }, fix: { kind: "manual" as const, summary: "fix the error" }, key: page.url })));

const crash: Check = {
  meta: { id: "x.crash", title: "crashes", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run() {
    throw new Error("boom");
  },
};

const slow: Check = {
  meta: { id: "x.slow", title: "finishes last", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: async function* (ctx) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const page = ctx.site.pages.get("/a.html")!;
    yield { message: "slow on /a.html", location: { file: page.file, line: 3, column: 7 }, fix: { kind: "manual" as const, summary: "fix the slow" }, key: page.url };
  },
};

// Finishes first: a plain iterable, no awaits at all.
const fast: Check = {
  meta: { id: "x.fast", title: "finishes first", severity: "note", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) => {
    const page = ctx.site.pages.get("/z.html")!;
    return [{ message: "fast on /z.html", location: { file: page.file, line: 2, column: 3 }, fix: { kind: "manual" as const, summary: "fix the fast" }, key: page.url }];
  },
};

test("--format ndjson writes one exact line per finding, in the check's order", async () => {
  const cwd = makeSite({ "dist/a.html": PAGE, "dist/b.html": PAGE });
  const chunks: string[] = [];
  const result = await run(["verify", "dist", "--format", "ndjson"], { cwd, checks: [xErr], stream: (chunk) => chunks.push(chunk) });
  const report = JSON.parse((await run(["verify", "dist", "--format", "json"], { cwd, checks: [xErr] })).stdout);
  assert.deepEqual(reportErrors(report), []);

  assert.equal(result.code, EXIT.findings);
  assert.equal(result.stdout.endsWith("\n"), true, "the last line is newline-terminated");
  const lines = result.stdout.split("\n");
  assert.equal(lines.length, report.findings.length + 1, "one line per finding plus the terminating newline");

  // The streamed chunks are exactly the stdout: each line went out as its check finished.
  assert.equal(chunks.join(""), result.stdout);
  for (const chunk of chunks) assert.match(chunk, /\n$/, "every chunk ends in a newline");

  // The first line, as literal bytes: the same fields, in the same order, as one finding
  // of the JSON report - checkId, severity, message, location, fix, fingerprint, prompt.
  assert.equal(
    lines[0],
    `{"checkId":"x.err","severity":"error","message":"err on /a.html","location":{"file":"a.html","line":3,"column":7},"fix":{"kind":"manual","summary":"fix the error","edits":[],"appliesTo":"built-output"},"fingerprint":"${fingerprint("x.err", "a.html", "/a.html")}","prompt":"Fix this Seaworthy finding. Check x.err (error) at dist/a.html:3:7. err on /a.html Fix: fix the error. The location is the built output; apply the same fix in the source that generates it, rebuild, then re-run seaworthy verify to confirm the finding is gone."}`,
  );

  // And every line is the JSON of exactly the report's finding at that position.
  for (const [index, line] of lines.entries()) {
    if (index === report.findings.length) break;
    assert.doesNotMatch(line, /[\r\n]/, "a finding is one line, whatever its message holds");
    assert.equal(line, JSON.stringify(report.findings[index]));
  }

  // A clean site streams nothing and exits 0.
  const clean = await run(["verify", makeSite({ "index.html": PAGE }), "--format", "ndjson"], { checks: [] });
  assert.deepEqual([clean.code, clean.stdout, clean.stderr], [EXIT.ok, "", ""]);
});

test("ndjson lines arrive as checks finish, while the JSON report keeps its sorted order", async () => {
  const site = makeSite({ "a.html": PAGE, "z.html": PAGE });
  const ndjson = await run(["verify", site, "--format", "ndjson"], { checks: [slow, fast] });
  const [fastLine, slowLine] = ndjson.stdout.split("\n").filter(Boolean);

  assert.equal(JSON.parse(fastLine!).checkId, "x.fast", "the fast check's finding lines first: it finished while x.slow was still waiting");
  assert.equal(JSON.parse(slowLine!).checkId, "x.slow", "x.slow's finding waited for its check to finish");
  assert.equal(JSON.parse(fastLine!).location.file, "z.html");

  const report = JSON.parse((await run(["verify", site, "--format", "json"], { checks: [slow, fast] })).stdout);
  assert.deepEqual(report.findings.map((f: Finding) => f.checkId), ["x.slow", "x.fast"], "the JSON report stays sorted by location");
});

test("streaming changes nothing about the run: the report is identical with and without the sink", async () => {
  const folder = makeSite({ "a.html": PAGE, "b.html": PAGE });
  const options = { folder, rootLabel: "site", checks: [xErr], now: new Date("2027-02-01T00:00:00Z") };

  const first = await verifySite(options);
  // Accepts a.html's finding (the first of the two): what streaming keeps must match the report.
  const baseline = createBaseline([first.unbaselined[0]!]);

  const streamed: Finding[] = [];
  const withSink = await verifySite({ ...options, baseline, streamFindings: (f) => streamed.push(f) });
  const withoutSink = await verifySite({ ...options, baseline });

  assert.deepEqual(withSink.report, withoutSink.report, "the report is byte-for-byte the same object either way");
  assert.deepEqual(withSink.unbaselined, withoutSink.unbaselined);
  assert.equal(streamed.length, withSink.report.findings.length);
  assert.deepEqual(streamed, withoutSink.report.findings, "the streamed set is exactly the report's findings, prompt included");
  assert.deepEqual(
    streamed.map((f) => f.location.file),
    ["b.html"],
    "the baseline accepts a.html's finding, so neither the report nor the stream shows it",
  );
});

test("ignored files, live suppressions, and the baseline never stream", async () => {
  const cwd = makeSite({
    "dist/a.html": '<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body><!-- seaworthy-ignore x.err: not now --><a href="/missing.html">x</a></body></html>\n',
    "dist/b.html": PAGE,
    "dist/c.html": PAGE,
    "seaworthy.config.json": JSON.stringify({ ignore: ["b.html"], checks: { "x.err": "error" } }),
  });
  const plain = await run(["verify", "dist", "--format", "json"], { cwd, checks: [xErr] });
  assert.equal(JSON.parse(plain.stdout).findings.length, 1, "sanity: a.html is suppressed inline and b.html is ignored, so only c.html is reported");

  const root = makeSite({ "dist/a.html": PAGE, "dist/c.html": PAGE });
  let streamed: string[] = [];
  const recorded = await run(["verify", "dist", "--format", "ndjson", "--update-baseline", "b.json"], { cwd: root, checks: [xErr], stream: (chunk) => streamed.push(chunk) });
  assert.equal(recorded.code, EXIT.ok);
  assert.deepEqual(streamed, [], "--update-baseline prints its summary, not NDJSON; nothing streams either way");
  assert.match(recorded.stdout, /baseline written to b\.json/);

  const result = await run(["verify", "dist", "--format", "ndjson", "--baseline", "b.json"], { cwd: root, checks: [xErr] });
  assert.equal(result.stdout, "", "baselined findings are not streamed, so nothing is left");
  assert.equal(result.code, EXIT.ok);
});

test("ndjson output has no machine-specific paths, and the same site gives identical bytes", async () => {
  const files = (newline: string) => ({
    "build/site output/docs/über page.html": PAGE.split("\n").join(newline),
    "build/site output/docs/guide.html": '<!doctype html><title>Target</title>',
  });
  const outputs: string[] = [];
  for (const newline of ["\n", "\r\n"]) {
    const cwd = makeSite(files(newline));
    const result = await run(["verify", "build/site output", "--format", "ndjson"], { cwd, checks: [xErr] });
    assert.equal(result.code, EXIT.findings);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes("\\\\"), "no Windows separators leak out");
    assert.ok(!result.stdout.includes(cwd), "no absolute paths leak into prompts");
    for (const line of result.stdout.split("\n").filter(Boolean)) {
      const finding = JSON.parse(line);
      assert.ok(!finding.location.file.includes("\\"), "location paths are forward-slash relative");
      assert.match(finding.prompt, /build\/site output\/docs\//, "prompts carry the report's relative root");
    }
    outputs.push(result.stdout);
  }
  assert.equal(outputs[1], outputs[0], "the source's line endings do not change a byte");
});

test("the machine formats and exit codes are unchanged when streaming is attached", async () => {
  const cwd = makeSite({ "dist/a.html": PAGE });
  const args = ["verify", "dist"] as const;
  let streamed: string[] = [];

  const jsonSink = await run([...args, "--format", "json"], { cwd, checks: [xErr], stream: (chunk) => streamed.push(chunk) });
  assert.equal(streamed.length, 0, "stream receives nothing for a format that does not stream");
  const json = await run([...args, "--format", "json"], { cwd, checks: [xErr] });
  assert.equal(jsonSink.stdout, json.stdout, "attaching a stream sink leaves the JSON output untouched");
  assert.deepEqual(reportErrors(JSON.parse(json.stdout)), []);

  streamed = [];
  const sarif = await run([...args, "--format", "sarif"], { cwd, checks: [xErr], stream: (chunk) => streamed.push(chunk) });
  assert.equal(streamed.length, 0);
  assert.deepEqual(sarifErrors(JSON.parse(sarif.stdout)), []);
  assert.match(sarif.stdout, /seaworthy\/v1/);

  const ndjson = await run([...args, "--format", "ndjson"], { cwd, checks: [xErr] });
  assert.deepEqual([json.code, sarif.code, ndjson.code], [EXIT.findings, EXIT.findings, EXIT.findings]);
  assert.equal((await run([...args, "--format", "ndjson", "--fail-on", "none"], { cwd, checks: [xErr] })).code, EXIT.ok);

  const crashed = await run([...args, "--format", "ndjson"], { cwd, checks: [crash] });
  assert.equal(crashed.code, EXIT.internal, "a crashed check keeps its exit code");
  assert.equal(crashed.stdout, "", "no lines are streamed for a check that never reported");
  assert.equal(crashed.stderr, "seaworthy: 1 check crashed; see the report\n");

  assert.match((await run([...args, "--format", "xml"], { cwd, checks: [] })).stderr, /use html, json, llm, markdown, ndjson, pretty, prompt, sarif/);
});

test("--out writes the ndjson file and prints a one-line summary; nothing streams", async () => {
  const cwd = makeSite({ "dist/a.html": PAGE });
  let streamCalls = 0;
  const result = await run(["verify", "dist", "--format", "ndjson", "--out", "reports/out.ndjson"], { cwd, checks: [xErr], stream: () => streamCalls++ });
  assert.equal(result.code, EXIT.findings);
  assert.equal(streamCalls, 0, "with --out nothing goes to stdout streaming");
  assert.equal(result.stdout, `seaworthy: 1 finding (1 error); ndjson report written to reports/out.ndjson\n`);

  const file = readFileSync(join(cwd, "reports", "out.ndjson"), "utf8");
  assert.equal(file.endsWith("\n"), true);
  assert.equal(file.split("\n").length, 2, "one finding, one terminating newline");

  const clean = await run(["verify", "dist", "--format", "ndjson", "--out", "r/empty.ndjson"], { cwd, checks: [] });
  assert.equal(clean.code, EXIT.ok);
  assert.equal(readFileSync(join(cwd, "r", "empty.ndjson"), "utf8"), "", "a clean run writes an empty file");
  assert.equal(clean.stdout, "seaworthy: no findings; ndjson report written to r/empty.ndjson\n");
});
