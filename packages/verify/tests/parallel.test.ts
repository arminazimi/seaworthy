// The parallel check pool (issue #218): static built-in checks run in worker threads over
// per-worker rebuilds of the site graph, and the run they produce is BYTE-IDENTICAL to the
// sequential one — findings, severities, fingerprints, skipped, errors, and the report JSON.
// These tests force the pool with SEAWORTHY_WORKERS; the size threshold keeps ordinary
// (small) runs sequential without it, which the budget unit test freezes.

import assert from "node:assert/strict";
import { test } from "node:test";

import { runChecks } from "../src/engine.js";
import { MAX_PARALLEL_WORKERS, PARALLEL_MIN_PAGES, runCheckPool, workerBudget, workerSafe, type WorkerJob, type WorkerOutcome } from "../src/check-pool.js";
import { builtInChecks } from "../src/checks/index.js";
import { a11yAxe } from "../src/checks/a11y-axe.js";
import { imagesAlt } from "../src/checks/images.js";
import { linksExternal } from "../src/checks/external.js";
import { buildReport, reportToJson } from "../src/report.js";
import { buildSite } from "../src/site.js";
import type { Check } from "../src/types.js";
import { verifySite } from "../src/verify.js";
import { makeSite } from "./helpers.js";

/** Save and restore the override around a block so the suite never leaks it into other files' runs. */
function withWorkers<T>(value: string | undefined, body: () => Promise<T>): Promise<T> {
  const previous = process.env.SEAWORTHY_WORKERS;
  if (value === undefined) delete process.env.SEAWORTHY_WORKERS;
  else process.env.SEAWORTHY_WORKERS = value;
  return body().finally(() => {
    if (previous === undefined) delete process.env.SEAWORTHY_WORKERS;
    else process.env.SEAWORTHY_WORKERS = previous;
  });
}

// A site with real findings for several pooled checks, big enough for the pool to matter when forced.
function brokenSite(): string {
  const pages: Record<string, string | Buffer> = {};
  for (let i = 0; i < 24; i += 1) {
    pages[`index.html`] ||= `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Home</title></head>\n<body><main><h1>Home</h1><a href="/p/0.html">start</a></main></body>\n</html>\n`;
    pages[`p/${i}.html`] = [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      `<title>Page ${i}</title>`,
      i % 3 === 0 ? "" : `<meta name="description" content="Page ${i} of the parallel pool test.">`,
      "</head>",
      "<body>",
      `<h1>Page ${i}</h1>`,
      i % 5 === 0 ? "<h3>skipped a level</h3>" : "<h2>Section</h2>",
      i % 4 === 0 ? '<p><img src="/logo.png" alt=""></p>' : '<p><img src="/logo.png"></p>',
      '<p><a href="/missing.html">dead</a> <a href="/p/' + ((i + 1) % 24) + '.html">onward</a></p>',
      `<p><a href="https://example.test/${i}" target="_blank">outside</a></p>`,
      "</body>",
      "</html>",
      "",
    ].filter((line) => line !== "").join("\n");
  }
  pages["logo.png"] = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return makeSite(pages);
}

test("workerBudget: sequential below the threshold, pool above it, the environment overrides both", () => {
  return withWorkers(undefined, async () => {
    assert.equal(workerBudget(PARALLEL_MIN_PAGES - 1, 66), 0, "a small site never starts threads");
    assert.equal(workerBudget(0, 1), 0, "one pooled check alone is not a pool");
    const big = workerBudget(PARALLEL_MIN_PAGES, 66);
    assert.ok(big >= 1 && big <= MAX_PARALLEL_WORKERS, `default budget ${big} is inside the cap`);
  });
});

test("workerBudget: SEAWORTHY_WORKERS forces the decision", async () => {
  // One at a time: the override is process-wide, so concurrent cases would read each other's value.
  await withWorkers("0", async () => assert.equal(workerBudget(PARALLEL_MIN_PAGES * 10, 66), 0));
  await withWorkers("1", async () => assert.equal(workerBudget(PARALLEL_MIN_PAGES * 10, 66), 0));
  await withWorkers("3", async () => assert.equal(workerBudget(1, 66), 3, "forced pools ignore the size threshold"));
  await withWorkers("9", async () => assert.equal(workerBudget(1, 2), 2, "never more workers than pooled checks"));
  await withWorkers("nonsense", async () => assert.equal(workerBudget(PARALLEL_MIN_PAGES - 1, 66), 0, "a bad value is ignored, not a crash"));
});

test("workerSafe: static built-ins qualify; browser, network, probed, and foreign checks do not", () => {
  assert.ok(workerSafe(imagesAlt, builtInChecks), "a static built-in check runs in a worker");
  assert.ok(!workerSafe(a11yAxe, builtInChecks), "a rendered check stays on the main thread");
  assert.ok(!workerSafe(linksExternal, builtInChecks), "a network check stays on the main thread");
  const foreign: Check = { meta: imagesAlt.meta, run: () => [] };
  assert.ok(!workerSafe(foreign, builtInChecks), "an ID match is not enough: the pool only runs the registry's own objects");
  const probed: Check = { meta: imagesAlt.meta, run: imagesAlt.run.bind(imagesAlt), probe: async () => undefined };
  const registry = builtInChecks.map((c) => (c === imagesAlt ? probed : c));
  assert.ok(!workerSafe(probed, registry), "a check with a pre-flight probe stays on the main thread");
});

test("the pool produces the identical run: findings, skipped, errors, and report JSON", async () => {
  const folder = brokenSite();
  const checks = builtInChecks;
  const run = (workers: string | undefined) =>
    withWorkers(workers, async () => {
      const site = buildSite(folder);
      const result = await runChecks({ site, checks, timings: true });
      const { report } = await verifySite({ folder, rootLabel: "site", checks, now: new Date("2027-01-01T00:00:00Z") });
      return { result, json: reportToJson(buildReport({ root: "site", pages: site.pages.size, checks, findings: result.findings, skipped: result.skipped, errors: result.errors })) };
    });

  const sequential = await run("1");
  const pooled = await run("4");

  assert.ok(sequential.result.findings.length > 0, "the site triggers findings");
  assert.ok(new Set(pooled.result.findings.map((f) => f.checkId)).size >= 2, "more than one check actually went through the pool");
  assert.deepEqual(pooled.result.findings, sequential.result.findings, "findings are identical, in identical order");
  assert.deepEqual(pooled.result.skipped, sequential.result.skipped, "skipped checks are identical");
  assert.deepEqual(pooled.result.errors, sequential.result.errors, "check errors are identical");
  assert.equal(pooled.json, sequential.json, "the report JSON is byte-for-byte the same");
  assert.equal(pooled.result.timings?.length, sequential.result.timings?.length, "every check that ran is timed in both modes");
  const ids = (pooled.result.timings ?? []).map((t) => t.check);
  assert.deepEqual(ids, [...ids].sort(), "timings stay sorted by check ID");
  assert.ok(pooled.result.timings!.every((t) => Number.isFinite(t.ms) && t.ms >= 0), "worker timings are real numbers");
});

test("a check the pool cannot carry reruns on the main thread without changing the run", async () => {
  const folder = brokenSite();
  // A caller-provided check that claims a built-in's ID: identity fails, so it runs on the
  // main thread — the registry's real check must not be swapped in for someone else's object.
  const impostor: Check = { meta: imagesAlt.meta, run: () => [{ message: "mine", location: { file: "p/0.html" }, fix: { kind: "manual", summary: "mine" }, key: "mine" }] };
  const run = (workers: string | undefined) =>
    withWorkers(workers, () => runChecks({ site: buildSite(folder), checks: builtInChecks.filter((c) => c.meta.id !== "images.alt").concat(impostor) }));
  const sequential = await run("1");
  const pooled = await run("4");
  assert.deepEqual(pooled.findings, sequential.findings);
  assert.ok(pooled.findings.some((f) => f.message === "mine"), "the impostor ran, on the main thread, in both modes");
});

test("runCheckPool executes built-in static checks in worker threads", async () => {
  const site = buildSite(brokenSite());
  const job = (checkId: string): WorkerJob => ({ checkId, root: site.root, basePath: site.basePath, options: {} });
  const jobs = [job("images.alt"), job("a11y.empty-headings"), job("meta.description")];
  const outcomes: WorkerOutcome[] = [];
  await runCheckPool(jobs, 2, (outcome) => outcomes.push(outcome));
  assert.equal(outcomes.length, jobs.length, "one outcome per job");
  assert.deepEqual(outcomes.map((o) => o.kind), ["findings", "findings", "findings"]);
  const alt = outcomes.find((o) => o.checkId === "images.alt");
  assert.ok(alt && alt.kind === "findings" && alt.drafts.length > 0, "the worker found the missing alt texts");
});

test("the streamed findings callback sees every pooled check's findings once", async () => {
  const folder = brokenSite();
  const streamed: string[] = [];
  await withWorkers("3", () =>
    runChecks({ site: buildSite(folder), checks: builtInChecks, onCheckFindings: (checkId, findings) => streamed.push(`${checkId}:${findings.length}`) }));
  const seq: string[] = [];
  await withWorkers("1", () =>
    runChecks({ site: buildSite(folder), checks: builtInChecks, onCheckFindings: (checkId, findings) => seq.push(`${checkId}:${findings.length}`) }));
  assert.equal(streamed.length, seq.length, "one call per check that ran, in both modes");
  assert.deepEqual([...streamed].sort(), [...seq].sort(), "the same checks with the same finding counts, whatever the order");
});
