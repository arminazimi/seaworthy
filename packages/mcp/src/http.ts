// The local Streamable HTTP transport (issue #254): the same MCP server `runStdio` connects, served
// on `http://<loopback>:<port>/mcp` so an agent that cannot spawn a process can still reach it.
//
// A listener is a security change, so this module is narrow on purpose:
//   - Opt-in only. Nothing listens unless the operator passes `--http`; stdio stays the default and
//     the default code path never imports the HTTP transport (main.ts branches, see `parseMcpArgs`).
//   - Loopback by default. The bind defaults to 127.0.0.1; a non-loopback host is refused unless the
//     operator passes `--allow-non-loopback` too, which is the operator's own exposure decision.
//   - No authentication, and none invented here: on a machine, anything that can open a connection to
//     the port can call the tools. What a caller can do is bounded instead: it verifies inside the
//     folder the server was started with (`--root`, default the current folder) and a request naming a
//     site outside it is refused. Seaworthy reports; it never edits the site.
//   - Host and Origin are checked, as the MCP spec asks of HTTP servers, so a page open in the
//     operator's browser cannot reach the port (DNS rebinding).

import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve, sep } from "node:path";
import { isIP, isIPv4 } from "node:net";

import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { createServer } from "./server.js";
import { VERIFY_CHANGED_NAME, VERIFY_SITE_NAME } from "./verify-tools.js";

/** The path the listener serves MCP on; every other path is a plain 404. */
export const HTTP_PATH = "/mcp";
/** The default bind address: loopback. Nothing else is reachable from another machine by accident. */
export const DEFAULT_HTTP_HOST = "127.0.0.1";
/** The port `--http` uses when `--port` is absent. `--port 0` asks for any free ephemeral port. */
export const DEFAULT_HTTP_PORT = 3333;

/** A POST body over this size is refused before it is parsed: the tool inputs are folder names and flags. */
const MAX_BODY_BYTES = 1_048_576;

/** The help line for `seaworthy-mcp`, printed by `--help` and after a usage error. */
export const MCP_HTTP_HELP = `Usage: seaworthy-mcp [--http] [options]

Without --http the server speaks JSON-RPC over stdio and exits when the client closes stdin. That is
the default, and what an MCP client that starts the process itself should use.

Options:
  --http                 Serve MCP over Streamable HTTP on ${HTTP_PATH} instead of stdio.
  --host <address>       Bind address for --http. Default ${DEFAULT_HTTP_HOST} (loopback). A non-loopback
                         address is refused unless you also pass --allow-non-loopback.
  --port <port>          Port for --http. Default ${DEFAULT_HTTP_PORT}; pass 0 for any free port, which is
                         printed on stderr once the listener is up.
  --root <dir>           The one folder this server may verify. Default the current folder. A tool call
                         naming a site outside it is refused.
  --allow-non-loopback   Allows --host outside loopback. Your own exposure decision: the transport is
                         NOT authenticated, so on a network every host that can reach the port can make
                         this server verify folders under --root on this machine.
  --help, -h             Print this help.

Exit codes: 0 after a clean shutdown (or --help), 2 for a bad command line.
`;

/** How the `seaworthy-mcp` entry point reads its command line. */
export interface HttpServerOptions {
  /** The bind address. Loopback unless `allowNonLoopback` says the operator meant otherwise. */
  readonly host: string;
  /** The bind port; 0 asks the operating system for a free one, which the listener reports. */
  readonly port: number;
  /** The only folder the tools may verify, resolved. */
  readonly root: string;
  /** Set only by `--allow-non-loopback`; without it a non-loopback `host` is refused. */
  readonly allowNonLoopback?: boolean;
  /** Where status lines go. Default stderr, so stdout stays clean. */
  readonly log?: (line: string) => void;
}

/** What `seaworthy-mcp` does with its arguments: the stdio default, the opt-in listener, help, or a usage error. */
export type McpInvocation =
  | { readonly kind: "stdio" }
  | { readonly kind: "help" }
  | { readonly kind: "usage"; readonly message: string }
  | { readonly kind: "http"; readonly options: HttpServerOptions };

/** A command line the operator must fix before anything starts. */
class HttpUsageError extends Error {}

/**
 * Reads `seaworthy-mcp`'s arguments. Without `--http` it answers `stdio` whatever else is on the line,
 * so the default path is the one that shipped before issue #254: no listener, no new behaviour.
 * With `--http` every argument is checked, because starting a listener is not the place to guess.
 */
export function parseMcpArgs(args: readonly string[]): McpInvocation {
  try {
    return parseArgs(args);
  } catch (error) {
    if (error instanceof HttpUsageError) return { kind: "usage", message: error.message };
    throw error;
  }
}

/** The codes the SDK's own transport answers these cases with, kept as numbers because the enum names are about connections. */
const BAD_REQUEST_CODE = -32_000;
const SESSION_NOT_FOUND_CODE = -32_001;

function parseArgs(args: readonly string[]): McpInvocation {
  let http = false;
  let allowNonLoopback = false;
  let host = DEFAULT_HTTP_HOST;
  let port = DEFAULT_HTTP_PORT;
  let root: string | undefined;

  let index = 0;
  while (index < args.length) {
    const arg = args[index] as string;
    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);

    switch (flag) {
      case "--help":
      case "-h":
        return { kind: "help" };
      case "--http":
        if (inline !== undefined) throw new HttpUsageError(`--http takes no value; use --host and --port`);
        http = true;
        index += 1;
        break;
      case "--allow-non-loopback":
        if (inline !== undefined) throw new HttpUsageError(`--allow-non-loopback takes no value`);
        allowNonLoopback = true;
        index += 1;
        break;
      case "--host": {
        const [v, last] = taken(flag, inline, args, index);
        host = v;
        index = last + 1;
        break;
      }
      case "--port": {
        const [v, last] = taken(flag, inline, args, index);
        port = parsePort(v);
        index = last + 1;
        break;
      }
      case "--root": {
        const [v, last] = taken(flag, inline, args, index);
        root = v;
        index = last + 1;
        break;
      }
      default:
        // Ignored while stdio is what runs (issue #254 changes no default); an error once a listener is asked for.
        if (http) throw new HttpUsageError(`unknown option "${flag}"`);
        index += 1;
        break;
    }
  }

  if (!http) return { kind: "stdio" };
  if (!isLoopbackHost(host) && !allowNonLoopback) {
    throw new HttpUsageError(
      `--host ${host} is not loopback, and an unauthenticated listener on a reachable address exposes this machine; pass --allow-non-loopback as well if you mean it`,
    );
  }
  return {
    kind: "http",
    options: {
      host,
      port,
      root: resolve(root ?? process.cwd()),
      ...(allowNonLoopback ? { allowNonLoopback: true } : {}),
    },
  };
}

/** The value of a flag that takes one: inline after `=`, else the next argument, which may never look like another flag. */
function taken(flag: string, inline: string | undefined, args: readonly string[], index: number): [string, number] {
  if (inline !== undefined) return [inline, index];
  const next = args[index + 1];
  if (next === undefined || next.startsWith("--")) throw new HttpUsageError(`${flag} needs a value`);
  return [next, index + 1];
}

function parsePort(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new HttpUsageError(`--port ${raw} is not a port number`);
  const port = Number(raw);
  if (port > 65_535) throw new HttpUsageError(`--port ${raw} is above 65535`);
  return port;
}

/** Whether the host literal means loopback: 127.0.0.0/8, ::1, or the name localhost. */
export function isLoopbackHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (name === "localhost") return true;
  if (!isIP(name)) return false;
  return isIPv4(name) ? name.startsWith("127.") : name === "::1";
}

/**
 * The Host and Origin values a request may carry: the loopback names for this port, or the address the
 * server was told to bind. `undefined` means a wildcard bind (0.0.0.0, ::), where the hostname is not
 * the operator's own address any more, so only the port is checked.
 */
function allowedRequestHosts(host: string, port: number): ReadonlySet<string> | undefined {
  const name = host.trim().toLowerCase();
  if (isLoopbackHost(name)) {
    const literals = ["127.0.0.1", "localhost", "::1", name];
    return new Set(literals.map((literal) => `${isIP(literal) && !isIPv4(literal) ? `[${literal}]` : literal}:${port}`));
  }
  if (name === "0.0.0.0" || name === "::" || name === "[::]") return undefined;
  return new Set([`${name}:${port}`]);
}

/** The `host:port` of a Host header or an Origin, or undefined when it carries neither a host nor our port. */
function requestAllowed(req: IncomingMessage, port: number, allowed: ReadonlySet<string> | undefined): boolean {
  const hostHeader = req.headers.host;
  if (typeof hostHeader !== "string" || !portMatches(hostHeader, port)) return false;
  if (allowed !== undefined && !allowed.has(hostHeader.toLowerCase())) return false;
  const origin = req.headers.origin;
  if (origin === undefined || origin === "null") return true; // non-browser clients send no Origin at all
  const from = originHost(origin);
  if (from === undefined) return false;
  if (allowed === undefined) return portMatches(from, port);
  return allowed.has(from);
}

function portMatches(value: string, port: number): boolean {
  const cut = value.lastIndexOf(":");
  const tail = cut === -1 ? undefined : value.slice(cut + 1);
  if (tail === undefined || !/^\d+$/.test(tail)) return port === 80;
  return Number(tail) === port;
}

function originHost(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.port === "" ? `${url.hostname}:80` : `${url.host.toLowerCase()}`;
  } catch {
    return undefined;
  }
}

/** Whether the site a request names is the configured folder or something under it, symlinks followed where they exist. */
export function insideFolder(root: string, site: string): boolean {
  const target = resolve(root, site);
  if (!within(root, target)) return false;
  return within(realpathNearest(root), realpathNearest(target));
}

function within(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** The real path of a folder, or of its nearest existing parent, so a symlinked parent cannot hide an escape. */
function realpathNearest(path: string): string {
  const missing: string[] = [];
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return path;
    missing.unshift(basename(current));
    current = parent;
  }
  try {
    return join(realpathSync(current), ...missing);
  } catch {
    return path;
  }
}

/** The tool call in this body that names a site outside the root, if any. Batches are checked whole. */
function outsideCall(root: string, body: unknown): { readonly id: unknown; readonly site: string } | undefined {
  for (const message of Array.isArray(body) ? body : [body]) {
    if (typeof message !== "object" || message === null) continue;
    const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
    if (method !== "tools/call") continue;
    const call = params as { name?: unknown; arguments?: unknown } | undefined;
    if (call?.name !== VERIFY_SITE_NAME && call?.name !== VERIFY_CHANGED_NAME) continue;
    const site = (call.arguments as { site?: unknown } | undefined)?.site;
    if (typeof site !== "string" || insideFolder(root, site)) continue;
    return { id: id ?? null, site };
  }
  return undefined;
}

/** A listener the caller must close. */
export interface HttpListener {
  /** The address actually bound, so `--port 0` is usable: the real port, not the one asked for. */
  readonly host: string;
  readonly port: number;
  /** Where an MCP client points its HTTP transport. */
  readonly url: string;
  /** Stops the listener, closes every session, and leaves no handle behind. */
  close(): Promise<void>;
}

/**
 * Starts the Streamable HTTP listener. One MCP server per session, the pattern the SDK documents: the
 * session id comes from `initialize` and routes later requests, and a request naming a site outside
 * `options.root` is refused before the server ever sees it.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<HttpListener> {
  // The same rule the command line enforces, for callers that build the options themselves.
  if (!isLoopbackHost(options.host) && options.allowNonLoopback !== true) {
    throw new HttpUsageError(`--host ${options.host} is not loopback and --allow-non-loopback was not given`);
  }

  // Loaded here, not at the top of the file, so the stdio path never pays for the HTTP transport.
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  /** One client session: the server instance its transport is connected to, and the way to end both. */
  interface Session {
    readonly server: ReturnType<typeof createServer>;
    readonly transport: StreamableHTTPServerTransport;
    close(): Promise<void>;
  }

  const sessions = new Map<string, Session>();
  const root = resolve(options.root);
  let allowed: ReadonlySet<string> | undefined;
  let boundPort = options.port;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requestAllowed(req, boundPort, allowed)) {
      answer(res, 403, { error: "forbidden", message: "this server answers only requests addressed to itself" });
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== HTTP_PATH) {
      answer(res, 404, { error: "not found", message: `this server speaks MCP on ${HTTP_PATH}` });
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const session = sessions.get(header(req.headers["mcp-session-id"]) ?? "");
      if (!session) {
        jsonRpcError(res, 400, null, BAD_REQUEST_CODE, `a ${req.method} needs the Mcp-Session-Id header of a live session`);
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    if (req.method !== "POST") {
      answer(res, 405, { error: "method not allowed", message: "POST, GET and DELETE are the methods this server answers" });
      return;
    }

    const body = await readBody(req, res);
    if (body === undefined) return; // readBody answered 413 or 400 already

    // The guard the stdio server does not need: a client of a listener is not the operator.
    const escape = outsideCall(root, body);
    if (escape !== undefined) {
      jsonRpcError(
        res,
        400,
        escape.id,
        ErrorCode.InvalidParams,
        `refused: "${escape.site}" is outside ${root}, the folder this server was started with (--root)`,
      );
      return;
    }

    const sessionId = header(req.headers["mcp-session-id"]);
    if (sessionId !== undefined) {
      const session = sessions.get(sessionId);
      if (!session) {
        jsonRpcError(res, 404, messageId(body), SESSION_NOT_FOUND_CODE, "Session not found");
        return;
      }
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (!isInitialize(body)) {
      jsonRpcError(res, 400, messageId(body), BAD_REQUEST_CODE, "Bad Request: Mcp-Session-Id header is required");
      return;
    }

    // One server per session, the pattern the SDK documents for this transport.
    const server = createServer({ cwd: root });
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true, // one JSON response per request; a client that wants a stream opens GET /mcp
      onsessioninitialized: (initialized) => {
        sessions.set(initialized, session);
      },
    });
    const session: Session = {
      server,
      transport,
      close: async () => {
        await transport.close(); // its onclose drops the session; a connected transport closing closes the server
        await server.close();
      },
    };
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    try {
      await transport.handleRequest(req, res, body);
    } finally {
      // A handshake that never produced a session must not leave the server and its tools behind.
      if (transport.sessionId === undefined || !sessions.has(transport.sessionId)) await session.close();
    }
  };

  const http: Server = createHttpServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      (options.log ?? ((line) => console.error(line)))(`seaworthy-mcp: request failed: ${message}`);
      if (!res.headersSent) answer(res, 500, { error: "internal error" });
      else res.end();
    });
  });

  await new Promise<void>((started, failed) => {
    http.once("error", failed);
    http.listen({ host: options.host, port: options.port }, () => {
      http.off("error", failed);
      const address = http.address();
      if (address === null || typeof address === "string") {
        failed(new Error("the HTTP listener did not report an address"));
        return;
      }
      boundPort = address.port;
      allowed = allowedRequestHosts(options.host, boundPort);
      started();
    });
  });

  const name = displayHost(options.host);
  return {
    host: options.host,
    port: boundPort,
    url: `http://${isIP(name) && !isIPv4(name) ? `[${name}]` : name}:${boundPort}${HTTP_PATH}`,
    close: async () => {
      for (const session of [...sessions.values()]) await session.close();
      sessions.clear();
      await new Promise<void>((done) => {
        http.closeAllConnections();
        http.close(() => done());
      });
    },
  };
}

/**
 * Runs the listener until the operator ends it: SIGINT or SIGTERM closes it and resolves. A bad command
 * line or a busy port is reported and sets the exit code; nothing here throws into the entry point.
 */
export async function runHttp(options: HttpServerOptions): Promise<void> {
  const log = options.log ?? ((line: string) => console.error(line));
  let listener: HttpListener;
  try {
    listener = await startHttpServer(options);
  } catch (error) {
    log(`seaworthy-mcp: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof HttpUsageError ? 2 : 1;
    return;
  }
  log(`seaworthy-mcp: listening on ${listener.url}; unauthenticated, verifying only inside ${options.root}`);
  if (!isLoopbackHost(options.host)) {
    log("seaworthy-mcp: WARNING this bind is outside loopback, so other hosts on the network can call these tools");
  }
  await new Promise<void>((finished) => {
    const stop = (): void => {
      void listener.close().then(finished, finished);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/** The body of a POST, capped and parsed here so the site guard can see the tool arguments before anything runs. */
async function readBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      answer(res, 413, { error: "too large", message: `the request body is over ${MAX_BODY_BYTES} bytes` });
      return undefined;
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) {
    jsonRpcError(res, 400, null, ErrorCode.ParseError, "a POST needs a JSON-RPC body");
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    jsonRpcError(res, 400, null, ErrorCode.ParseError, "Bad Request: invalid JSON body");
    return undefined;
  }
}

function isInitialize(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some((message) => typeof message === "object" && message !== null && (message as { method?: unknown }).method === "initialize");
}

function messageId(body: unknown): unknown {
  const message = (Array.isArray(body) ? body[0] : body) as { id?: unknown } | undefined;
  return message?.id ?? null;
}

function header(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value[0] : undefined;
}

/** The host as it should appear in a URL: the bound name, with 0.0.0.0 and :: shown as loopback-reachable. */
function displayHost(host: string): string {
  const name = host.trim().toLowerCase();
  return name === "0.0.0.0" ? "127.0.0.1" : name === "::" ? "::1" : name;
}

function answer(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function jsonRpcError(res: ServerResponse, status: number, id: unknown, code: number, message: string): void {
  answer(res, status, { jsonrpc: "2.0", id, error: { code, message } });
}
