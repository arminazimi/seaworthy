import assert from "node:assert/strict";
import { watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EXIT, run } from "../src/cli.js";
import { diffReports } from "../src/diff.js";
import { runChecks } from "../src/engine.js";
import { buildReport } from "../src/report.js";
import { buildSite } from "../src/site.js";
import type { Check, Report } from "../src/types.js";
import { WatchLoop, WatchScheduler, watchDiffText, watchStatusText } from "../src/watch.js";
import { makeSite } from "./helpers.js";

// One finding per page: a broken link marker. A new page file is a new finding; removing a page
// is a fixed one. The fingerprint covers the check ID plus the page URL, so it moves with the page.
const problem: Check = {
  meta: { id: "x.err", title: "broken link", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) => [...ctx.site.pages.values()].map((page) => ({ message: `error on ${page.url}`, location: { file: page.file, line: 3, column: 1 }, fix: { kind: "manual" as const, summary: "fix the link" }, key: page.url })),
};

const PAGE = '<!doctype html><html lang="en"><head><title>t</title></head><body>a</body></html>\n';

async function reportOf(files: Record<string, string>, root: string): Promise<Report> {
  const site = buildSite(makeSite(files));
  const { findings, errors } = await runChecks({ site, checks: [problem] });
  return buildReport({ root, pages: site.pages.size, checks: [problem], findings, skipped: [], errors });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until the condition holds; throws if not reached within the timeout, saying what did happen. */
function describe<T>(state: () => T): string {
  return JSON.stringify(state());
}
async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000, state?: () => unknown): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}${state ? `; state: ${describe(state)}` : ""}`);
    await sleep(10);
  }
}

test("watchStatusText prints a counting headline with one + line per new and one - line per fixed finding", async () => {
  const before = await reportOf({ "a.html": PAGE }, "site");
  const added = await reportOf({ "a.html": PAGE, "b.html": PAGE }, "site");
  assert.equal(
    watchStatusText(before, added),
    `seaworthy: 1 new, 0 fixed, 1 unchanged findings\n` +
      `  + error x.err site/b.html:3:1: error on /b.html\n`,
  );
  assert.equal(
    watchStatusText(added, before),
    `seaworthy: 0 new, 1 fixed, 1 unchanged findings\n` +
      `  - error x.err site/b.html:3:1: error on /b.html (fixed)\n`,
  );
});

test("watchStatusText is deterministic and silent when nothing changed", async () => {
  const before = await reportOf({ "a.html": PAGE, "b.html": PAGE }, "site");
  const after = await reportOf({ "b.html": PAGE, "a.html": PAGE }, "site"); // same findings, different page order
  const text = watchStatusText(before, after);
  assert.equal(text, watchStatusText(before, after), "deterministic");
  assert.equal(text, "seaworthy: no findings changed (2 unchanged)\n");
});

test("watchDiffText renders a precomputed diff exactly like the watch loop does", async () => {
  const before = await reportOf({ "a.html": PAGE }, "site");
  const after = await reportOf({ "a.html": PAGE, "b.html": PAGE }, "site");
  assert.equal(watchDiffText(diffReports(before, after)), watchStatusText(before, after));
});

// ---- WatchScheduler: debouncing and the one-scan-in-flight invariant ----

test("a change schedules a scan after the quiet window, not before", async () => {
  let runs = 0;
  const scheduler = new WatchScheduler(async () => { runs++; }, { debounceMs: 60 });
  scheduler.changed();
  await sleep(20);
  assert.equal(runs, 0, "nothing runs while the folder is still changing");
  await waitFor(() => runs === 1, "the debounced scan");
  scheduler.stop();
});

test("a burst of changes collapses into exactly one scan", async () => {
  let runs = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const scheduler = new WatchScheduler(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(10);
    inFlight--;
    runs++;
  }, { debounceMs: 30 });
  scheduler.changed();
  await sleep(5);
  scheduler.changed();
  await sleep(5);
  scheduler.changed();
  await sleep(8);
  scheduler.changed();
  scheduler.changed();
  await sleep(60);
  assert.equal(runs, 1, "a burst of writes before the quiet window is one run");
  assert.equal(maxInFlight, 1);
  scheduler.stop();
  await sleep(40);
  assert.equal(runs, 1, "no trailing scan after stop");
});

test("regression: at most one scan is ever in flight, and events during a scan queue one follow-up", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const scheduler = new WatchScheduler(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(30);
    inFlight--;
  }, { debounceMs: 0 });

  const first = scheduler.scanNow();
  await sleep(5); // the first scan is now running
  assert.equal(scheduler.busy, true);
  scheduler.changed();
  scheduler.changed();
  scheduler.changed();
  await scheduler.scanNow(); // re-entrant request: must queue a follow-up, never start a second scan
  assert.ok(scheduler.runs <= 1, `no extra scan starts while one is in flight (runs: ${scheduler.runs})`);
  assert.ok(scheduler.rerunQueued, "the events coalesce into one queued follow-up");
  await first;
  await waitFor(() => scheduler.runs === 2, "the single queued follow-up", 3000, () => ({ runs: scheduler.runs, busy: scheduler.busy, pending: scheduler.rerunQueued }));
  await sleep(60);
  assert.equal(scheduler.runs, 2, "exactly one follow-up, not one per event");
  assert.equal(maxInFlight, 1);
});

test("scan errors are reported and do not stop scheduling; stop cancels a debounced scan", async () => {
  const failures: unknown[] = [];
  const scheduler = new WatchScheduler(async () => { throw new Error("boom"); }, { debounceMs: 0, onError: (error) => failures.push(error) });
  await scheduler.scanNow();
  scheduler.changed();
  await scheduler.scanNow();
  assert.equal(scheduler.runs, 0);
  assert.deepEqual(failures, [new Error("boom"), new Error("boom")]);

  let runs = 0;
  const cancelled = new WatchScheduler(async () => { runs++; }, { debounceMs: 100 });
  cancelled.changed();
  cancelled.stop();
  await sleep(150);
  assert.equal(runs, 0, "the debounced scan was cancelled");
});

// ---- WatchLoop: watcher semantics with an injected change source ----

function loopOf(options: { run: () => Promise<Report>; previous: Report; notify: (text: string) => void; error: (text: string) => void }): { loop: WatchLoop; hooks: { change: () => void; failed: (error: unknown) => void } } {
  // The holder object is stable: start() fills it, so the test can bind it before start().
  const hooks: { change: () => void; failed: (error: unknown) => void } = { change: () => {}, failed: (error) => { void error; } };
  const loop = new WatchLoop({
    folder: "site",
    previous: options.previous,
    run: options.run,
    notify: options.notify,
    error: options.error,
    debounceMs: 5,
    open: (real) => {
      hooks.change = real.change;
      hooks.failed = real.failed;
      return { close: () => {} };
    },
  });
  return { loop, hooks };
}

test("WatchLoop runs once per change against the previous report and keeps watching", async () => {
  const before = await reportOf({ "a.html": PAGE }, "site");
  const after = await reportOf({ "a.html": PAGE, "b.html": PAGE }, "site");
  const notices: string[] = [];
  const failures: string[] = [];
  const { loop, hooks } = loopOf({ previous: before, run: async () => after, notify: (text) => notices.push(text), error: (text) => failures.push(text) });
  loop.start();
  try {
    hooks.change();
    await waitFor(() => notices.length === 1, "the notice for the first change", 2000, () => ({ notices, failures, runs: loop.runs }));
    assert.equal(notices[0], watchStatusText(before, after));
    assert.equal(failures.length, 0);
    assert.equal(loop.runs, 1);
  } finally {
    loop.close();
  }
});

test("WatchLoop survives a failed verification and stays quiet once closed", async () => {
  const before = await reportOf({ "a.html": PAGE }, "site");
  const notices: string[] = [];
  const failures: string[] = [];
  let runs = 0;
  const { loop, hooks } = loopOf({
    previous: before,
    run: async () => {
      runs++;
      if (runs === 1) throw new Error("unreadable file");
      return before;
    },
    notify: (text) => notices.push(text),
    error: (text) => failures.push(text),
  });
  loop.start();
  try {
    hooks.change();
    await waitFor(() => failures.length === 1, "the failure notice");
    assert.equal(notices.length, 0);
    hooks.change();
    await waitFor(() => notices.length === 1, "the retry after the failure");
    assert.equal(loop.runs, 2);
  } finally {
    loop.close();
  }
  hooks.change();
  await sleep(80);
  assert.equal(loop.runs, 2, "a closed loop ignores further changes");
});

test("WatchLoop reports a watcher crash instead of crashing itself", async () => {
  const before = await reportOf({ "a.html": PAGE }, "site");
  const failures: string[] = [];
  const notices: string[] = [];
  const { loop, hooks } = loopOf({ previous: before, run: async () => before, notify: (text) => notices.push(text), error: (text) => failures.push(text) });
  loop.start();
  hooks.failed(new Error("ENOSPC"));
  assert.match(failures[0] ?? "", /^seaworthy: watch: the watcher stopped \(ENOSPC\)\n$/);
  assert.equal(loop.busy, false);
});

function recursiveWatchWorks(folder: string): boolean {
  try {
    const probe = watch(folder, { recursive: true }, () => {});
    probe.close();
    return true;
  } catch {
    return false;
  }
}

// ---- Integration: the real CLI with the real fs.watch on a temp build folder ----

test("seaworthy verify --watch prints the first report in full and then only the diff on change", async (t) => {
  const folder = makeSite({ "index.html": PAGE });
  if (!recursiveWatchWorks(folder)) return t.skip("recursive fs.watch is not available in this environment");

  const notices: string[] = [];
  const failures: string[] = [];
  let loop: WatchLoop | undefined;
  const watched = await run(["verify", folder, "--watch"], {
    checks: [problem],
    watch: { debounceMs: 25, write: (text) => notices.push(text), writeError: (text) => failures.push(text), onLoop: (l) => { loop = l; } },
  });
  const plain = await run(["verify", folder], { checks: [problem] });
  assert.equal(watched.code, EXIT.findings);
  assert.equal(watched.stdout, plain.stdout, "the first --watch run is byte-identical to the non-watch run");
  assert.equal(watched.stderr, plain.stderr);
  assert.equal(notices.length, 0, "before any change, watch prints nothing extra");

  try {
    writeFileSync(join(folder, "about.html"), PAGE);
    await waitFor(() => notices.length > 0, "the watch diff after the write");
    const text = notices.join("");
    assert.match(text, /^seaworthy: 1 new, 0 fixed, 1 unchanged findings?\n/);
    assert.match(text, /\+ error x\.err .*about\.html.*: error on \/about\.html\n/);
  } finally {
    loop?.close();
  }
  assert.equal(failures.length, 0);
});
