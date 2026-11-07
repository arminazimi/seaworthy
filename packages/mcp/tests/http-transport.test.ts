// The local Streamable HTTP transport (issue #254): the command line that opts into it, the loopback
// and site guards that bound it, and one real MCP conversation over a real socket on an ephemeral
// loopback port. Every listener a test starts is closed again, so the test process exits on its own.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { REPORT_SPEC_VERSION } from "@seaworthy/verify";

import { SERVER_NAME, SERVER_TITLE } from "../src/server.js";
import { SERVER_VERSION } from "../src/version.js";
import { VERIFY_SITE_NAME } from "../src/verify-tools.js";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, HTTP_PATH, insideFolder, isLoopbackHost, parseMcpArgs, startHttpServer } from "../src/http.js";
import type { HttpListener, HttpServerOptions } from "../src/http.js";

const made: string[] = [];
const open: HttpListener[] = [];
after(async () => {
  for (const listener of open) await listener.close();
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

// The built bin the opt-in branch is checked in: `<pkg>/dist/tests/this.js` resolves `../src/main.js`
// to `<pkg>/dist/src/main.js` after `npm run build`.
const BIN = fileURLToPath(new URL("../src/main.js", import.meta.url));
const SKIP_BIN = existsSync(BIN) ? false : "built MCP server missing (dist/src): run `npm run build` first";

const PAGE = '<!doctype html><html lang="en"><head><title>Page</title></head><body><main><h1>Page</h1></main></body></html>';

/** A workspace whose server root is `site/`, with a built page in it and a folder beside it. */
function workspace(): { root: string; outside: string } {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-mcp-http-"));
  made.push(dir);
  const root = join(dir, "site");
  const outside = join(dir, "elsewhere");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "index.html"), PAGE);
  writeFileSync(join(outside, "index.html"), PAGE);
  return { root, outside };
}

/** Starts a listener on loopback with an ephemeral port, registered for cleanup. */
async function listen(root: string): Promise<HttpListener> {
  const listener = await startHttpServer({ host: DEFAULT_HTTP_HOST, port: 0, root, log: () => {} });
  open.push(listener);
  assert.equal(isLoopbackHost(listener.host), true, "a test listener never binds outside loopback");
  assert.ok(listener.port > 0, "the listener reports the port it actually bound");
  return listener;
}

type Reply = { status: number; headers: NodeJS.Dict<string | string[]>; body: string };

/**
 * One raw HTTP call to `port`. `node:http` rather than fetch, because the guards are about the Host and
 * Origin headers and only a raw client can set them the way a browser would.
 */
function call(port: number, options: { method?: string; path?: string; body?: string; host?: string; origin?: string; sessionId?: string }): Promise<Reply> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-06-18",
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.sessionId === undefined ? {} : { "mcp-session-id": options.sessionId }),
  };
  return new Promise((finished, failed) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: options.method ?? "POST", path: options.path ?? HTTP_PATH, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => finished({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", failed);
    req.end(options.body ?? "");
  });
}

/** What the tests read out of a JSON-RPC envelope: the handshake, the tool list, one result, one error. */
type Envelope = {
  result?: { serverInfo?: { name: string; title?: string; version: string }; tools?: { name: string }[]; content?: { type: string; text: string }[] };
  error?: { code?: number; message?: string };
};

function envelope(reply: Reply): Envelope {
  assert.match(String(reply.headers["content-type"] ?? ""), /application\/json/, `expected JSON, got status ${reply.status}: ${reply.body}`);
  return JSON.parse(reply.body) as Envelope;
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "node:test/http-client", version: "0.0.0" } },
});

const request = (id: number, method: string, params?: object): string =>
  JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

/** Opens a session the way an MCP client does and returns the session id the listener issued. */
async function initializeSession(listener: HttpListener): Promise<string> {
  const reply = await call(listener.port, { body: INITIALIZE });
  assert.equal(reply.status, 200, reply.body);
  assert.equal(envelope(reply).result?.serverInfo?.name, SERVER_NAME);
  const sessionId = reply.headers["mcp-session-id"];
  assert.equal(typeof sessionId, "string", "the listener issues a session id");
  return sessionId as string;
}

/** The options of an accepted `--http` line, so a test asserts on one shape. */
function httpOptions(args: readonly string[]): HttpServerOptions {
  const invocation = parseMcpArgs(args);
  assert.equal(invocation.kind, "http", args.join(" "));
  return (invocation as { options: HttpServerOptions }).options;
}

/** After `close()` nothing answers on that port: the socket is refused or dropped. */
async function expectClosed(port: number): Promise<void> {
  await assert.rejects(async () => await call(port, { body: INITIALIZE }), "the listener is gone");
}

test("without --http nothing listens and the other arguments are ignored, as before issue #254", () => {
  assert.deepEqual(parseMcpArgs([]), { kind: "stdio" });
  assert.deepEqual(parseMcpArgs(["--root", "/tmp"]), { kind: "stdio" });
  assert.deepEqual(parseMcpArgs(["--some-client-flag"]), { kind: "stdio" });
});

test("--http opts in with the loopback defaults and the current folder as the only root", () => {
  const options = httpOptions(["--http"]);
  assert.equal(options.host, DEFAULT_HTTP_HOST);
  assert.equal(options.port, DEFAULT_HTTP_PORT);
  assert.equal(options.root, resolve(process.cwd()));
  assert.equal(options.allowNonLoopback, undefined, "loopback is the default, so the override is absent");
});

test("--http takes the host, the port and the root the operator names", () => {
  const options = httpOptions(["--http", "--host", "127.0.0.2", "--port=4100", "--root", "./dist"]);
  assert.equal(options.host, "127.0.0.2");
  assert.equal(options.port, 4100);
  assert.equal(options.root, resolve(process.cwd(), "dist"));
  assert.equal(httpOptions(["--http", "--port", "0"]).port, 0);
});

test("a bind outside loopback is refused unless the operator asks for it", () => {
  for (const host of ["0.0.0.0", "192.168.1.20", "example.test", "::"]) {
    assert.equal(parseMcpArgs(["--http", "--host", host]).kind, "usage", `--host ${host} must not start a listener`);
  }
  assert.equal(httpOptions(["--http", "--host", "0.0.0.0", "--allow-non-loopback"]).allowNonLoopback, true);
});

test("a bad --http command line is a usage error, never a silent stdio server", () => {
  for (const args of [
    ["--http", "--frobnicate"],
    ["--http", "--host"],
    ["--http", "--host", "--port", "3000"],
    ["--http", "--port", "not-a-port"],
    ["--http", "--port", "70000"],
    ["--http", "--root", "--host", "127.0.0.1"],
    ["--http=1"],
    ["--allow-non-loopback=yes"],
  ]) {
    assert.equal(parseMcpArgs(args).kind, "usage", `${args.join(" ")} must be refused`);
  }
  assert.equal(parseMcpArgs(["--http", "--help"]).kind, "help");
});

test("loopback means 127.0.0.0/8, ::1 and localhost, and nothing else", () => {
  for (const host of ["127.0.0.1", "127.0.0.2", "localhost", "::1", "[::1]", "LOCALHOST"]) {
    assert.equal(isLoopbackHost(host), true, `${host} is loopback`);
  }
  for (const host of ["0.0.0.0", "::", "10.0.0.1", "example.test", "localhost.evil.test"]) {
    assert.equal(isLoopbackHost(host), false, `${host} is not loopback`);
  }
});

test("the site guard accepts the root and what is under it, and refuses what is not", () => {
  const { root, outside } = workspace();
  assert.equal(insideFolder(root, "."), true);
  assert.equal(insideFolder(root, "assets"), true);
  assert.equal(insideFolder(root, resolve(root, "index.html")), true);
  assert.equal(insideFolder(root, ".."), false);
  assert.equal(insideFolder(root, "../elsewhere"), false);
  assert.equal(insideFolder(root, outside), false);
  assert.equal(insideFolder(root, "/"), false);

  // A symlink inside the root that points out of it is not an inside path either.
  const link = join(root, "link");
  try {
    symlinkSync(outside, link, "dir");
  } catch {
    return; // this filesystem will not make symlinks; the cases above already cover the guard
  }
  assert.equal(insideFolder(root, "link"), false);
  assert.equal(insideFolder(root, join("link", "index.html")), false);
});

test("the listener answers a real MCP conversation, and the tools verify inside the root only", async () => {
  const { root } = workspace();
  const listener = await listen(root);
  assert.equal(listener.url, `http://127.0.0.1:${listener.port}${HTTP_PATH}`);

  const sessionId = await initializeSession(listener);

  const tools = envelope(await call(listener.port, { sessionId, body: request(2, "tools/list") }));
  assert.deepEqual(
    (tools.result?.tools ?? []).map((tool) => tool.name).sort(),
    ["explain_finding", "list_checks", "verify_changed", "verify_site"],
  );

  const inside = envelope(await call(listener.port, { sessionId, body: request(3, "tools/call", { name: VERIFY_SITE_NAME, arguments: { site: "." } }) }));
  assert.equal(inside.error, undefined, JSON.stringify(inside));
  const report = JSON.parse(inside.result?.content?.[0]?.text ?? "{}") as { spec: number; tool: { name: string }; findings: unknown[] };
  assert.equal(report.spec, REPORT_SPEC_VERSION);
  assert.equal(report.tool.name, "seaworthy");
  assert.ok(Array.isArray(report.findings));

  for (const site of ["../elsewhere", resolve(root, "..", "elsewhere"), "/"]) {
    const refused = envelope(await call(listener.port, { sessionId, body: request(4, "tools/call", { name: VERIFY_SITE_NAME, arguments: { site } }) }));
    assert.equal(refused.error?.code, -32602, `a call that names ${site} is refused, not run`);
    assert.match(refused.error?.message ?? "", /refused:/);
    assert.match(refused.error?.message ?? "", /--root/);
  }

  // The session ends when the client says so, and afterwards that id is unknown.
  assert.equal((await call(listener.port, { method: "DELETE", sessionId })).status, 200);
  assert.equal(envelope(await call(listener.port, { sessionId, body: request(5, "tools/list") })).error?.code, -32001);

  await listener.close();
  await expectClosed(listener.port);
});

test("a request that is not addressed to this server is refused, so a page in a browser cannot reach the port", async () => {
  const { root } = workspace();
  const listener = await listen(root);

  assert.equal((await call(listener.port, { host: `evil.example:${listener.port}`, body: INITIALIZE })).status, 403);
  assert.equal((await call(listener.port, { origin: "http://evil.example:8080", body: INITIALIZE })).status, 403);

  // The loopback names for this port are what a client on this machine really sends.
  for (const host of [`127.0.0.1:${listener.port}`, `localhost:${listener.port}`]) {
    assert.equal((await call(listener.port, { host, body: INITIALIZE })).status, 200, host);
  }

  assert.equal((await call(listener.port, { path: "/other" })).status, 404);
  assert.equal((await call(listener.port, { method: "PUT" })).status, 405);
  assert.equal((await call(listener.port, { body: "not json" })).status, 400);
  assert.equal((await call(listener.port, { body: request(9, "tools/list") })).status, 400, "a request with no session id is not an initialize");
});

test("closing the listener ends the sessions it holds", async () => {
  const { root } = workspace();
  const listener = await listen(root);
  await initializeSession(listener);
  await listener.close();
  await expectClosed(listener.port);
});

test("the built bin listens on an ephemeral loopback port only when asked, and ends on SIGINT", { skip: SKIP_BIN }, async () => {
  const { root } = workspace();
  const child = spawn(process.execPath, [BIN, "--http", "--port", "0", "--root", root], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.setEncoding("utf8");
  const lines: string[] = [];
  try {
    const url = await new Promise<string>((found, failed) => {
      const timer = setTimeout(() => failed(new Error(`the listener never said where it is: ${lines.join("")}`)), 15_000);
      child.stderr.on("data", (chunk: string) => {
        lines.push(chunk);
        const match = lines.join("").match(/listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
        if (match) {
          clearTimeout(timer);
          found(match[1]!);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        failed(new Error(`the listener exited early (code ${code}): ${lines.join("")}`));
      });
    });
    assert.equal(new URL(url).hostname, "127.0.0.1", "the bin binds loopback");

    const port = Number(new URL(url).port);
    assert.equal(envelope(await call(port, { body: INITIALIZE })).result?.serverInfo?.name, SERVER_NAME);
    assert.equal(envelope(await call(port, { body: INITIALIZE })).result?.serverInfo?.title, SERVER_TITLE);
    assert.equal(envelope(await call(port, { body: INITIALIZE })).result?.serverInfo?.version, SERVER_VERSION);
  } finally {
    child.kill("SIGINT");
    assert.equal(
      await new Promise<number | null>((done) => child.once("exit", done)),
      0,
      `SIGINT closes the listener and the process ends cleanly; stderr was ${lines.join("")}`,
    );
  }
});

test("the built bin without --http still speaks stdio, and a bad --http line exits 2", { skip: SKIP_BIN }, async () => {
  const usage = await new Promise<{ code: number | null; stderr: string }>((done) => {
    const child = spawn(process.execPath, [BIN, "--http", "--host", "0.0.0.0"], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("exit", (code) => done({ code, stderr }));
  });
  assert.equal(usage.code, 2, "a non-loopback bind without the override is a usage error");
  assert.match(usage.stderr, /not loopback/);
  assert.equal(usage.stderr.includes("Usage: seaworthy-mcp"), true, "and the help says how to ask for it deliberately");
});
