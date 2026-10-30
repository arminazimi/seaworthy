// End-to-end for issue #252 over the SDK's own plumbing: a real MCP `Client` from
// @modelcontextprotocol/sdk calls the real `createServer()` over InMemoryTransport, and a raw
// spy on the client transport records every JSON-RPC message in wire order. With the SDK's
// `onprogress` request option the client sends `_meta.progressToken` itself (shared/protocol.js
// attaches it); without it, no token is on the wire and the server must stay silent. All
// assertions are on the recorded message sequence — nothing waits on the clock, and the checks
// are a single hand-made check so the order is deterministic.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { Check } from "@seaworthy/verify";

import { createServer } from "../src/server.js";
import { VERIFY_SITE_NAME } from "../src/verify-tools.js";

/** A workspace with a two-page built site, removed when the test ends. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-progress-e2e-"));
  const page = (title: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1><img src="a.png"></main></body></html>`;
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.html"), page("Index"));
  writeFileSync(join(dir, "dist", "about.html"), page("About"));
  return dir;
}

const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) =>
    [...ctx.site.pages.values()]
      .filter((page) => page.source.includes("<img src="))
      .sort((a, b) => (a.file < b.file ? -1 : 1))
      .map((page) => ({ message: "no alt", location: { file: page.file, line: 1 }, fix: { kind: "manual" as const, summary: "add alt" }, key: page.url })),
};

type Wire = { jsonrpc: "2.0"; id?: unknown; method?: string; params?: unknown; result?: unknown };

interface Harness {
  readonly client: Client;
  readonly received: Wire[];
  close: () => Promise<void>;
}

/** Connect a real SDK client to a real server and record every message the client receives. */
async function linked(cwd: string): Promise<Harness> {
  const server = createServer({ cwd, checks: [imgCheck] });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "progress-e2e", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
  const received: Wire[] = [];
  const deliver = clientSide.onmessage!;
  clientSide.onmessage = (message, extra) => {
    received.push(message as Wire);
    deliver(message, extra);
  };
  return {
    client,
    received,
    close: async () => {
      await client.close();
      await server.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

/** The progress notifications among the recorded messages, with their wire envelope intact. */
function progressOnTheWire(received: readonly Wire[]): Array<{ progressToken: string | number; progress: number; message: string; total?: unknown }> {
  const seen = received.filter((message) => message.method === "notifications/progress");
  for (const message of seen) assert.equal(message.id, undefined, "a progress notification carries no JSON-RPC id");
  return seen.map((message) => message.params as { progressToken: string | number; progress: number; message: string; total?: unknown });
}

test("a tools/call with onprogress receives ordered notifications/progress before the response", async () => {
  const cwd = workspace();
  const harness = await linked(cwd);
  try {
    const callbacks: Array<{ progress: number; message?: string }> = [];
    const result = await harness.client.callTool({ name: VERIFY_SITE_NAME, arguments: { site: "dist" } }, undefined, {
      onprogress: (progress) => callbacks.push(progress as { progress: number; message?: string }),
    });

    const seen = progressOnTheWire(harness.received);
    assert.equal(seen.length, 6, "started, parsed, running checks, one per finding, finished");
    const tokens = new Set(seen.map((n) => n.progressToken));
    assert.equal(tokens.size, 1, "one token echoed on every notification");
    assert.equal(typeof [...tokens][0], "number", "the SDK's client assigned a numeric progressToken and the server echoed it");
    assert.deepEqual(seen.map((n) => n.progress), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(seen.map((n) => n.message), [
      "started: verifying dist",
      "parsed 2 pages",
      "running checks",
      "finding 1: images.alt in about.html",
      "finding 2: images.alt in index.html",
      "finished: 2 findings reported",
    ]);
    for (const n of seen) assert.equal("total" in n, false, "no fabricated total");

    // Wire order: every progress notification precedes the tools/call response on the stream.
    const responseIndex = harness.received.findIndex((message) => message.result !== undefined);
    assert.ok(responseIndex > 0, "the response arrived");
    for (const message of harness.received.slice(0, responseIndex)) {
      assert.equal(message.method, "notifications/progress", "only progress notifications came before the response");
    }
    assert.equal(callbacks.length, seen.length, "the SDK delivered every notification to onprogress too");
    assert.equal(result.isError, undefined);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.equal(JSON.parse(content[0]!.text).summary.findings, 2);
  } finally {
    await harness.close();
  }
});

test("a tools/call without onprogress sends no token and receives no notifications", async () => {
  const cwd = workspace();
  const harness = await linked(cwd);
  try {
    const result = await harness.client.callTool({ name: VERIFY_SITE_NAME, arguments: { site: "dist" } });
    assert.deepEqual(progressOnTheWire(harness.received), [], "no progress token means no progress notifications on the wire");
    const content = result.content as Array<{ type: string; text: string }>;
    const report = JSON.parse(content[0]!.text) as { root: string; summary: { findings: number } };
    assert.equal(report.root, "dist");
    assert.equal(report.summary.findings, 2, "the same report a progress-carrying call got");
  } finally {
    await harness.close();
  }
});
