// Unit tests for the `wait_for_build` tool: the report after a real write, the bounded timeout,
// the cancelled request, the reach of the watcher, and the folders it refuses to watch. The waits
// are driven by real `fs.watch` events on real temp folders (plus one injected change source for
// the close-on-timeout case), and every case is bounded by the tool's own `timeout_ms`, so a
// regression answers instead of hanging. No server process and no network here.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import type { Check } from "@seaworthy/verify";

import { DEFAULT_WAIT_TIMEOUT_MS, MAX_WAIT_TIMEOUT_MS, WAIT_FOR_BUILD_DESCRIPTION, WAIT_FOR_BUILD_NAME, waitForBuildReport, waitForNextBuild } from "../src/wait-for-build.js";
import type { ChangeSource } from "../src/wait-for-build.js";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A workspace folder with the given files, cleaned up after the test file. */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-mcp-wait-"));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lets the writes that set a temp folder up age out of the change source. A macOS watcher hands a
 * brand-new `fs.watch` the folder's very recent history: measured here, an event older than ~50 ms
 * is never replayed. Tests that assert a quiet folder stays quiet wait 400 ms first, so they judge
 * the wait and not the setup.
 */
const QUITE_MS = 400;

const PAGE = '<!doctype html><html lang="en"><head><title>Page</title></head><body><main><h1>Page</h1><img src="a.png"></main></body></html>';

/** One check that flags every page, so a test can count the files the report covers. */
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

interface ReportShape {
  root: string;
  findings: Array<{ checkId: string; location: { file: string } }>;
}

const parse = (text: string): ReportShape => JSON.parse(text) as ReportShape;
const filesOf = (report: ReportShape): string[] => report.findings.map((finding) => finding.location.file);

/** What an injected change source did: how often it opened, how often it closed, and how to emit. */
interface WatchSpy {
  opened: number;
  closed: number;
  emit: (() => void) | undefined;
}

/** A change source that counts its own open and close instead of watching the disk. */
function injected(spy: WatchSpy): ChangeSource {
  return (hooks) => {
    spy.opened++;
    spy.emit = hooks.change;
    return { close: () => spy.closed++ };
  };
}

/** A change source that reports a change the moment it opens: the wait ends after one debounce. */
function alreadyChanged(): ChangeSource {
  return (hooks) => {
    hooks.change();
    return { close() {} };
  };
}

test("wait_for_build waits for a real write and returns the report of the build that landed", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  const writing = delay(5).then(() => writeFileSync(join(cwd, "dist", "b.html"), PAGE));
  const text = await waitForBuildReport({ site: "dist", timeout_ms: 3_000 }, { cwd, checks: [imgCheck], debounceMs: 25 });
  await writing;
  const report = parse(text);
  assert.deepEqual(reportErrors(report), [], "the tool returns a report that matches the report contract");
  assert.equal(report.root, "dist", "the report names the folder it watched, never an absolute path");
  assert.deepEqual(filesOf(report), ["a.html", "b.html"], "the report is of the build that landed, not of the folder as it was before the wait");
});

test("the settle window makes one build's burst of writes one report", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  const writing = delay(5)
    .then(() => writeFileSync(join(cwd, "dist", "b.html"), PAGE))
    .then(() => delay(10))
    .then(() => writeFileSync(join(cwd, "dist", "c.html"), PAGE));
  const report = parse(await waitForBuildReport({ site: "dist", timeout_ms: 3_000 }, { cwd, checks: [imgCheck], debounceMs: 60 }));
  await writing;
  assert.deepEqual(filesOf(report), ["a.html", "b.html", "c.html"], "the wait ends after the burst, so the report holds every page of it");
});

test("a repeated call observes the same build and answers with the same bytes", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  const first = await waitForBuildReport({ site: "dist", timeout_ms: 3_000 }, { cwd, checks: [imgCheck], debounceMs: 1, open: alreadyChanged() });
  const second = await waitForBuildReport({ site: "dist", timeout_ms: 3_000 }, { cwd, checks: [imgCheck], debounceMs: 1, open: alreadyChanged() });
  assert.equal(first, second, "two calls on an unchanged build give the same bytes: nothing that varies from run to run, such as a clock, reaches the JSON");
});

test("nothing changes: the wait is bounded and closes the watcher it opened", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  const spy: WatchSpy = { opened: 0, closed: 0, emit: undefined };
  await assert.rejects(
    () => waitForBuildReport({ site: "dist", timeout_ms: 50 }, { cwd, checks: [imgCheck], debounceMs: 5, open: injected(spy) }),
    /wait_for_build: dist did not change within 50 ms; nothing was verified/,
  );
  assert.deepEqual([spy.opened, spy.closed], [1, 1], "one watcher, closed by the timeout: no handle outlives the answer");
  spy.emit?.();
  assert.equal(spy.closed, 1, "an event after the answer re-arms nothing");
});

test("the real watcher settles when the build folder is really written to", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  const build = join(cwd, "dist");
  // No `open` injected: this is the recursive `fs.watch` that `--watch` opens, on the real folder.
  const waiting = waitForNextBuild(build, { timeoutMs: 3_000, label: "dist", debounceMs: 20 });
  writeFileSync(join(build, "b.html"), PAGE);
  await waiting;
});

test("the real watcher gives its bounded answer when the folder stays quiet", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  const build = join(cwd, "dist");
  await delay(QUITE_MS);
  // Reaching this rejection is the proof the wait is bounded; the watcher it opened is closed on
  // the way out, which is why this test file's process still exits on its own.
  await assert.rejects(() => waitForNextBuild(build, { timeoutMs: 150, label: "dist" }), /did not change within 150 ms/);
});

test("a cancelled request stops the wait and closes the watcher", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  const controller = new AbortController();
  const spy: WatchSpy = { opened: 0, closed: 0, emit: undefined };
  const waiting = waitForBuildReport({ site: "dist", timeout_ms: 30_000 }, { cwd, checks: [imgCheck], signal: controller.signal, open: injected(spy) });
  await delay(10);
  controller.abort();
  await assert.rejects(() => waiting, /the request was cancelled while waiting for the next build/);
  assert.deepEqual([spy.opened, spy.closed], [1, 1], "aborting the request closes the watcher instead of leaving it running");
});

test("a signal that aborted before the call watches nothing at all", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  const controller = new AbortController();
  controller.abort();
  const spy: WatchSpy = { opened: 0, closed: 0, emit: undefined };
  await assert.rejects(
    () => waitForBuildReport({ site: "dist", timeout_ms: 30_000 }, { cwd, checks: [imgCheck], signal: controller.signal, open: injected(spy) }),
    /the request was cancelled/,
  );
  assert.equal(spy.opened, 0, "an already-cancelled request never opens a watcher");
});

test("a write outside the build folder does not end the wait", async () => {
  const cwd = workspace({ "dist/a.html": PAGE, "src/app.js": "console.log(1)\n" });
  writeFileSync(join(cwd, "src", "app.js"), "console.log(2)\n");
  await delay(QUITE_MS);
  await assert.rejects(
    () => waitForBuildReport({ site: "dist", timeout_ms: 150 }, { cwd, checks: [imgCheck], debounceMs: 5 }),
    /did not change within 150 ms/,
    "the watcher sits on the folder the caller named and never reaches outside it",
  );
});

test("it refuses to watch the workspace, a folder above it, or the filesystem root", async () => {
  const cwd = workspace({ "dist/a.html": PAGE });
  for (const site of [".", "..", "/"]) {
    await assert.rejects(() => waitForBuildReport({ site, timeout_ms: 50 }, { cwd, checks: [imgCheck] }), /refuses to watch/);
  }
  // The same refusal holds when the path arrives as a symlink into the workspace.
  symlinkSync(cwd, join(cwd, "dist", "up"), "dir");
  await assert.rejects(() => waitForBuildReport({ site: "dist/up", timeout_ms: 50 }, { cwd, checks: [imgCheck] }), /refuses to watch/);
});

test("a folder that is not built reads the same as it does for verify_site", async () => {
  const cwd = workspace({ "README.md": "x" });
  await assert.rejects(() => waitForBuildReport({}, { cwd, checks: [imgCheck] }), /no built site found.*dist, build, out, public, _site, site/);
  await assert.rejects(() => waitForBuildReport({ site: "missing", timeout_ms: 50 }, { cwd, checks: [imgCheck] }), /no folder missing/);
  await assert.rejects(() => waitForBuildReport({ site: "README.md", timeout_ms: 50 }, { cwd, checks: [imgCheck] }), /not a folder/);
});

test("the folder to watch comes from the config, like verify_site finds it", async () => {
  // `dist` exists so folder discovery alone would pick it; the config's `root` is what decides.
  const cwd = workspace({ "dist/other.html": PAGE, "build/index.html": PAGE, "seaworthy.config.json": JSON.stringify({ root: "build" }) });
  const writing = delay(5).then(() => writeFileSync(join(cwd, "build", "page.html"), PAGE));
  const report = parse(await waitForBuildReport({ timeout_ms: 3_000 }, { cwd, checks: [imgCheck], debounceMs: 25 }));
  await writing;
  assert.equal(report.root, "build", "the config's root is the folder the watcher sat on");
  assert.deepEqual(filesOf(report), ["index.html", "page.html"], "and it is the folder the report describes");
});

test("the tool's advertised words carry the bound, so no client has to guess it", () => {
  assert.equal(WAIT_FOR_BUILD_NAME, "wait_for_build");
  assert.match(WAIT_FOR_BUILD_DESCRIPTION, new RegExp(`default ${DEFAULT_WAIT_TIMEOUT_MS} ms`));
  assert.ok(DEFAULT_WAIT_TIMEOUT_MS <= MAX_WAIT_TIMEOUT_MS, "the default is inside the bound a caller may ask for");
  assert.doesNotMatch(WAIT_FOR_BUILD_DESCRIPTION, /npm|https?:\/\/|hosted|service|released/i, "the MCP server is not published; nothing may imply a hosted service");
});
