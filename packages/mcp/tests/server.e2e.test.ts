// End-to-end: spawn the built MCP server as a child process and speak real JSON-RPC over stdio,
// asserting exact wire behavior of the skeleton: the initialize handshake, the advertised tool
// list, one tool call, the error paths, and shutdown on client hangup. Skipped with a reason
// where the environment lacks the capability (the built server has not compiled yet).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ErrorCode, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { builtInChecks, REPORT_SPEC_VERSION } from "@seaworthy/verify";

import { LIST_CHECKS_DESCRIPTION } from "../src/list-checks.js";
import { CHECK_CATALOG_DESCRIPTION, CHECK_CATALOG_NAME, CHECK_CATALOG_URI } from "../src/catalog.js";
import { PLANNED_TOOLS } from "../src/planned.js";
import { SERVER_NAME, SERVER_TITLE } from "../src/server.js";
import { SERVER_VERSION } from "../src/version.js";
import { VERIFY_CHANGED_DESCRIPTION, VERIFY_CHANGED_NAME, VERIFY_SITE_DESCRIPTION, VERIFY_SITE_NAME } from "../src/verify-tools.js";

// The built server the tests spawn: `<pkg>/dist/tests/server.e2e.test.js` imports `../src/main.js`,
// which resolves to `<pkg>/dist/src/main.js` after `npm run build`.
const SERVER = fileURLToPath(new URL("../src/main.js", import.meta.url));

/** Skip with a reason when the environment cannot spawn the server; tests stay portable. */
const SKIP_SPAWN = existsSync(SERVER) ? false : "built MCP server missing (dist/src): run `npm run build` first";

const LINE_TIMEOUT_MS = 10_000;
const SILENCE_MS = 250;
const EXIT_TIMEOUT_MS = 10_000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RpcMessage = { jsonrpc: "2.0"; id?: unknown; [key: string]: unknown };

/** Sends a JSON-RPC request; omit `params` for parameterless methods like `tools/list`. */
const request = (id: number, method: string, params?: object): RpcMessage => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params ? { params } : {}),
});

/** Sends a JSON-RPC notification (no `id`: it expects no response). */
const notify = (method: string): RpcMessage => ({ jsonrpc: "2.0", method });

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * One spawned server, driven like an MCP client: newline-delimited JSON-RPC on stdin/stdout.
 * Every test creates its own child and stops it in a `finally` so failed assertions still reap it.
 */
class RpcChild {
  readonly child: ChildProcess;
  private readonly stderrLines: string[] = [];
  private readonly buffered: string[] = [];
  private readonly waiters: Array<(line: string) => void> = [];
  private readonly exited: Promise<number | null>;

  constructor(child: ChildProcess) {
    this.child = child;
    child.stderr?.setEncoding("utf8");
    createInterface({ input: child.stderr! }).on("line", (line) => {
      this.stderrLines.push(line);
    });
    child.stdout?.setEncoding("utf8");
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      const waiter = this.waiters.shift();
      if (waiter) waiter(trimmed);
      else this.buffered.push(trimmed);
    });
    this.exited = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve(signal ? null : code));
    });
  }

  private diagnostics(prefix: string): string {
    const stderr = this.stderrLines.slice(-10).join("\n") || "(empty)";
    return `${prefix}\n--- server stderr ---\n${stderr}`;
  }

  private nextLine(): Promise<string> {
    if (this.buffered.length > 0) return Promise.resolve(this.buffered.shift()!);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Writes one newline-terminated JSON-RPC message to the server's stdin. */
  send(message: RpcMessage): void {
    this.child.stdin!.write(JSON.stringify(message) + "\n");
  }

  /** Resolves the next JSON-RPC message the server writes to stdout; rejects with diagnostics on timeout/exit. */
  async next(what = "a response"): Promise<RpcMessage> {
    if (this.buffered.length > 0) return JSON.parse(this.buffered.shift()!) as RpcMessage;
    const exit = this.exited.then((code) => {
      throw new Error(this.diagnostics(`server exited before responding (exit code ${code})`));
    });
    const line = await withTimeout(
      Promise.race([this.nextLine(), exit]),
      LINE_TIMEOUT_MS,
      this.diagnostics(`timed out after ${LINE_TIMEOUT_MS} ms waiting for ${what}`),
    );
    return JSON.parse(line) as RpcMessage;
  }

  /** Passes when nothing arrived on stdout within `SILENCE_MS`: notifications must not be answered. */
  async expectNoResponse(): Promise<void> {
    assert.equal(this.buffered.length, 0, "stdout already had an unexpected message");
    await delay(SILENCE_MS);
    assert.equal(
      this.buffered.length,
      0,
      `expected silence within ${SILENCE_MS} ms but the server wrote ${JSON.stringify(this.buffered)}`,
    );
  }

  /** Closes stdin, the way an MCP client ends a session, and returns the server's exit code. */
  async hangup(): Promise<number | null> {
    this.child.stdin!.end();
    return await withTimeout(
      this.exited,
      EXIT_TIMEOUT_MS,
      this.diagnostics(`server did not exit within ${EXIT_TIMEOUT_MS} ms after stdin closed`),
    );
  }

  /** Terminates the child when a test failed early; safe to call when it already exited. */
  async stop(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
    try {
      this.child.stdin?.end();
    } catch {
      // The stdin may already be closed after a hangup; that is fine.
    }
    await Promise.race([this.exited, delay(2_000)]);
  }
}

async function startServer(): Promise<RpcChild> {
  return new RpcChild(spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] }));
}

/** Speaks the initialize handshake on a fresh child and returns the exact initialize result. */
async function initialize(child: RpcChild, protocolVersion = "2025-06-18"): Promise<RpcMessage> {
  const params = {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "node:test/mcp-client", version: "0.0.0" },
  };
  child.send(request(1, "initialize", params));
  const reply = await child.next("the initialize response");
  assert.equal(reply.jsonrpc, "2.0");
  assert.equal(reply.id, 1);
  child.send(notify("notifications/initialized"));
  await child.expectNoResponse();
  return reply.result! as RpcMessage;
}

test("initialize answers the negotiated protocol version, capabilities, and serverInfo", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    const result = await initialize(child);
    assert.deepEqual(result, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
      serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
    });
  } finally {
    await child.stop();
  }
});

test("initialize falls back to the SDK's latest version for an unsupported protocol version", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    child.send(request(1, "initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "c", version: "0" } }));
    const reply = await child.next();
    assert.equal(reply.id, 1);
    assert.deepEqual(reply.result, {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
      serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
    });
  } finally {
    await child.stop();
  }
});

test("tools/list advertises exactly the implemented tools, never planned-but-unbuilt ones", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    await initialize(child);
    child.send(request(2, "tools/list"));
    const reply = await child.next();
    assert.equal(reply.jsonrpc, "2.0");
    assert.equal(reply.id, 2);
    assert.deepEqual(reply.result, {
      tools: [
        {
          name: "list_checks",
          description: LIST_CHECKS_DESCRIPTION,
          inputSchema: { type: "object", properties: {} },
          // The SDK marks synchronous tools this way in 1.32.x.
          execution: { taskSupport: "forbidden" },
        },
        {
          name: VERIFY_SITE_NAME,
          description: VERIFY_SITE_DESCRIPTION,
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              site: { description: "The built site folder, relative to the workspace. Default: the first of dist, build, out, public, _site, site that exists.", type: "string" },
              base: { description: 'The base path the site is deployed under, such as "/repo/". Default: the config\'s basePath, else what a known generator config says, else "/".', type: "string" },
              rendered: { description: "Run the checks that render pages in a browser. Opt-in: needs a browser installed on this machine.", type: "boolean" },
              network: { description: "Let the checks that need it reach the network. Opt-in: every other check stays offline.", type: "boolean" },
            },
          },
          execution: { taskSupport: "forbidden" },
        },
        {
          name: VERIFY_CHANGED_NAME,
          description: VERIFY_CHANGED_DESCRIPTION,
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              site: { description: "The built site folder, relative to the workspace. Default: the first of dist, build, out, public, _site, site that exists.", type: "string" },
              base: { description: 'The base path the site is deployed under, such as "/repo/". Default: the config\'s basePath, else what a known generator config says, else "/".', type: "string" },
              rendered: { description: "Run the checks that render pages in a browser. Opt-in: needs a browser installed on this machine.", type: "boolean" },
              network: { description: "Let the checks that need it reach the network. Opt-in: every other check stays offline.", type: "boolean" },
              since: { description: "A git ref (branch, tag, or commit) to compare the site with. Default: the files that changed since the last run.", type: "string" },
            },
          },
          execution: { taskSupport: "forbidden" },
        },
      ],
    });
  } finally {
    await child.stop();
  }
});

test("tools/list advertises no tool that is still planned", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    await initialize(child);
    child.send(request(2, "tools/list"));
    const reply = await child.next();
    const tools = (reply.result as { tools: Array<{ name: string }> }).tools;
    for (const planned of PLANNED_TOOLS) {
      assert.equal(
        tools.some((tool) => tool.name === planned),
        false,
        `${planned} is planned but not implemented, so it must not be advertised`,
      );
    }
  } finally {
    await child.stop();
  }
});

test("tools/call list_checks returns deterministic check metadata from the verify API", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    await initialize(child);
    child.send(request(3, "tools/call", { name: "list_checks", arguments: {} }));
    const reply = await child.next();
    assert.equal(reply.jsonrpc, "2.0");
    assert.equal(reply.id, 3);
    const result = reply.result as { content: Array<{ type: string; text: string }>; isError?: unknown };
    assert.deepEqual(Object.keys(result), ["content"]);
    assert.deepEqual(result.content, [{ type: "text", text: (result.content[0] as { text: string }).text }]);
    const text = result.content[0]!.text;
    const output = JSON.parse(text) as { spec: number; checks: Array<Record<string, unknown>> };
    assert.deepEqual(Object.keys(output), ["spec", "checks"], "field order is part of the deterministic output");
    assert.equal(output.spec, REPORT_SPEC_VERSION);
    assert.equal(output.checks.length, builtInChecks.length);
    assert.equal(new Set(output.checks.map((check) => check.id)).size, output.checks.length, "check ids are unique");
    assert.deepEqual(
      output.checks.map((check) => check.id),
      [...builtInChecks].map((check) => check.meta.id).sort(),
      "checks are sorted by id",
    );
    const first = builtInChecks[0]!.meta;
    const asListed = (meta: typeof first) => ({ id: meta.id, title: meta.title, severity: meta.severity, needs: meta.needs, docs: meta.docs, standards: meta.standards });
    const sortedMetas = [...builtInChecks].map((check) => check.meta).sort(byId);
    assert.deepEqual(output.checks, sortedMetas.map(asListed));
    for (const check of output.checks) {
      assert.deepEqual(Object.keys(check), ["id", "title", "severity", "needs", "docs", "standards"]);
    }
  } finally {
    await child.stop();
  }
});

test("resources/list advertises the check catalog and resources/read serves it", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    await initialize(child);
    child.send(request(7, "resources/list"));
    const listed = await child.next();
    assert.equal(listed.id, 7);
    assert.deepEqual(listed.result, {
      resources: [
        {
          uri: CHECK_CATALOG_URI,
          name: CHECK_CATALOG_NAME,
          description: CHECK_CATALOG_DESCRIPTION,
          mimeType: "application/json",
        },
      ],
    });

    child.send(request(8, "resources/read", { uri: CHECK_CATALOG_URI }));
    const read = await child.next();
    assert.equal(read.id, 8);
    const contents = (read.result as { contents: Array<{ uri: string; mimeType: string; text: string }> }).contents;
    assert.equal(contents.length, 1);
    assert.equal(contents[0]!.uri, CHECK_CATALOG_URI);
    assert.equal(contents[0]!.mimeType, "application/json");
    const catalog = JSON.parse(contents[0]!.text) as { spec: number; checks: Array<{ id: string }> };
    assert.equal(catalog.spec, REPORT_SPEC_VERSION);
    assert.equal(catalog.checks.length, builtInChecks.length);
  } finally {
    await child.stop();
  }
});

test("the catalog resource and the list_checks tool serve the same bytes", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    await initialize(child);
    child.send(request(9, "resources/read", { uri: CHECK_CATALOG_URI }));
    const read = await child.next();
    const resourceText = (read.result as { contents: Array<{ text: string }> }).contents[0]!.text;
    child.send(request(10, "tools/call", { name: "list_checks", arguments: {} }));
    const called = await child.next();
    const toolText = ((called.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text;
    assert.equal(resourceText, toolText, "the tool and the resource cannot disagree");
  } finally {
    await child.stop();
  }
});

test("calling a planned but unimplemented tool is a tool error, not invented data", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    await initialize(child);
    child.send(request(4, "tools/call", { name: "explain_finding", arguments: {} }));
    const reply = await child.next();
    assert.equal(reply.jsonrpc, "2.0");
    assert.equal(reply.id, 4);
    assert.deepEqual(reply.result, {
      content: [{ type: "text", text: "MCP error -32602: Tool explain_finding not found" }],
      isError: true,
    });
  } finally {
    await child.stop();
  }
});

test("tools/call verify_site returns the report JSON of the named site", { skip: SKIP_SPAWN }, async () => {
  const site = mkdtempSync(join(tmpdir(), "seaworthy-mcp-e2e-"));
  try {
    writeFileSync(join(site, "index.html"), '<!doctype html><html lang="en"><head><title>Page</title></head><body><main><h1>Page</h1></main></body></html>');
    const child = await startServer();
    try {
      await initialize(child);
      child.send(request(6, "tools/call", { name: VERIFY_SITE_NAME, arguments: { site } }));
      const reply = await child.next();
      assert.equal(reply.jsonrpc, "2.0");
      assert.equal(reply.id, 6);
      const result = reply.result as { content: Array<{ type: string; text: string }>; isError?: unknown };
      assert.equal(result.isError, undefined, "a site with findings is a result, not an error");
      const report = JSON.parse(result.content[0]!.text) as { spec: number; root: string; findings: unknown[] };
      assert.equal(report.spec, REPORT_SPEC_VERSION);
      assert.equal(report.root.split("/").pop(), basename(site), "the folder is named relative to the workspace, never as an absolute path");
      assert.ok(Array.isArray(report.findings));
    } finally {
      await child.stop();
    }
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test("an unknown method answers with the JSON-RPC method-not-found error", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    await initialize(child);
    child.send(request(5, "frobnicate"));
    const reply = await child.next();
    assert.equal(reply.jsonrpc, "2.0");
    assert.equal(reply.id, 5);
    assert.deepEqual(reply.error, { code: ErrorCode.MethodNotFound, message: "Method not found" });
  } finally {
    await child.stop();
  }
});

test("the server exits when the client closes stdin", { skip: SKIP_SPAWN }, async () => {
  const child = await startServer();
  try {
    await initialize(child);
    assert.equal(await child.hangup(), 0);
  } finally {
    await child.stop();
  }
});
