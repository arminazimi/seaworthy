// Unit tests for the progress plumbing (issue #252): what a caller that sent a
// `_meta.progressToken` sees on the wire, and the rule that a caller that did not send one
// sees nothing and gets a byte-identical result. Everything runs offline against temp fixtures
// with a single hand-made check, so the notification sequence is fully deterministic — no
// wall-clock assertions, no timers, no races.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { ProgressNotification, ServerNotification } from "@modelcontextprotocol/sdk/types.js";

import type { Check } from "@seaworthy/verify";

import { withProgress, type ToolRequestExtra } from "../src/progress.js";
import { verifyChangedReport, verifySiteReport } from "../src/verify-tools.js";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A workspace with a two-page built site, cleaned up after the test file. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-progress-"));
  made.push(dir);
  mkdirSync(join(dir, "dist"), { recursive: true });
  const page = (title: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1><img src="a.png"></main></body></html>`;
  writeFileSync(join(dir, "dist", "index.html"), page("Index"));
  writeFileSync(join(dir, "dist", "about.html"), page("About"));
  return dir;
}

/** The only check the runs use: one finding per page, emitted in sorted file order. */
const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) =>
    [...ctx.site.pages.values()]
      .filter((page) => page.source.includes("<img src="))
      .sort((a, b) => (a.file < b.file ? -1 : 1))
      .map((page) => ({ message: "no alt", location: { file: page.file, line: 1 }, fix: { kind: "manual" as const, summary: "add alt" }, key: page.url })),
};

/** A fake of the SDK's per-request `extra`: records every notification, never blocks. */
function fakeExtra(progressToken?: string | number): { extra: ToolRequestExtra; sent: ProgressNotification[] } {
  const sent: ProgressNotification[] = [];
  const extra: ToolRequestExtra = {
    sendNotification: async (notification: ServerNotification) => {
      sent.push(notification as ProgressNotification);
    },
    ...(progressToken === undefined ? {} : { _meta: { progressToken } }),
  };
  return { extra, sent };
}

/** The `notifications/progress` sequence one run produced, envelope invariants checked along the way. */
function messages(sent: readonly ProgressNotification[], progressToken: string | number, expectedSteps: number): string[] {
  const messages = sent.map((notification, index) => {
    assert.equal(notification.method, "notifications/progress", "only the standard progress method, never a bespoke one");
    assert.equal(notification.params.progressToken, progressToken, "every notification echoes the caller's token");
    assert.equal(notification.params.progress, index + 1, "progress counts up by one, starting at one");
    assert.equal("total" in notification.params, false, "no total: the engine exposes no total-work figure to promise against");
    return notification.params.message!;
  });
  assert.equal(messages.length, expectedSteps, "exactly the expected number of progress steps");
  return messages;
}

test("without a progress token the options are untouched and nothing is ever sent", async () => {
  const cwd = workspace();
  const { extra, sent } = fakeExtra();
  const options = { cwd, checks: [imgCheck] as readonly Check[] };
  assert.equal(withProgress(options, extra), options, "no token: the very same options object comes back");

  const plain = await verifySiteReport({ site: "dist" }, options);
  assert.equal(sent.length, 0, "a call that did not ask for progress gets zero notifications");
  assert.equal(plain.includes('"findings"'), true, "and still gets the full report");
});

test("_meta without a progressToken is the same as no _meta", async () => {
  const { extra, sent } = fakeExtra();
  const options = { cwd: "x" };
  const wrapped = withProgress(options, { ...extra, _meta: {} });
  assert.equal(wrapped, options);
  assert.equal(sent.length, 0);
});

test("a string progress token produces the honest coarse sequence, in order", async () => {
  const cwd = workspace();
  const { extra, sent } = fakeExtra("tok-7");
  const options = withProgress({ cwd, checks: [imgCheck] as readonly Check[] }, extra);
  const text = await verifySiteReport({ site: "dist" }, options);
  const report = JSON.parse(text) as { root: string; summary: { findings: number; pages: number } };

  const seen = messages(sent, "tok-7", 6);
  assert.deepEqual(seen, [
    `started: verifying ${report.root}`,
    "parsed 2 pages",
    "running checks",
    "finding 1: images.alt in about.html",
    "finding 2: images.alt in index.html",
    `finished: ${report.summary.findings} findings reported`,
  ], "started, stage boundaries, findings so far, finished — and nothing invented between them");
  assert.deepEqual([...new Set(sent.map((n) => n.params.progress))], [1, 2, 3, 4, 5, 6], "progress is strictly increasing");
  assert.equal(report.summary.pages, 2);
});

test("a numeric progress token works the same and the report bytes are untouched by streaming", async () => {
  const cwd = workspace();
  const { extra, sent } = fakeExtra(7);
  const options = withProgress({ cwd, checks: [imgCheck] as readonly Check[] }, extra);
  const streamed = await verifySiteReport({ site: "dist" }, options);

  messages(sent, 7, 6);
  const plain = await verifySiteReport({ site: "dist" }, { cwd, checks: [imgCheck] as readonly Check[] });
  assert.equal(streamed, plain, "with or without progress the tool returns the identical report JSON");
});

test("verify_changed streams progress too, with a byte-identical result", async () => {
  const cwdA = workspace();
  const cwdB = workspace();
  const { extra, sent } = fakeExtra("tok-changed");
  const withIt = await verifyChangedReport({ site: "dist" }, withProgress({ cwd: cwdA, checks: [imgCheck] as readonly Check[] }, extra));
  const without = await verifyChangedReport({ site: "dist" }, { cwd: cwdB, checks: [imgCheck] as readonly Check[] });
  assert.equal(withIt, without, "changed-mode progress is streaming-only: same report bytes");
  const seen = messages(sent, "tok-changed", 6);
  assert.equal(seen[0]!.startsWith("started: verifying "), true);
  assert.deepEqual(seen.slice(1, 3), ["parsed 2 pages", "running checks"]);
  assert.equal(seen[5]!.startsWith("finished: "), true);
});

test("a failing transport never blocks or fails the run", async () => {
  const cwd = workspace();
  const attempts: ServerNotification[] = [];
  const extra: ToolRequestExtra = {
    _meta: { progressToken: "gone" },
    sendNotification: (notification) => {
      attempts.push(notification);
      return Promise.reject(new Error("client hung up"));
    },
  };
  const options = withProgress({ cwd, checks: [imgCheck] as readonly Check[] }, extra);
  const result = await verifySiteReport({ site: "dist" }, options);
  assert.equal(attempts.length, 6, "every step was still attempted");
  assert.equal(JSON.parse(result).summary.findings, 2, "and the run finished normally despite them all failing");
});
