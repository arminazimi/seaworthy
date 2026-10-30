// The live-fixture server (issue #316): a built site served over real HTTP from inside a test, so
// the work that reads a deployed site — #307's fetch, and the HTTP checks that follow it — can be
// exercised against actual sockets, redirects, headers and status codes without a network.
//
// The rules this file exists to hold:
//   - **Loopback, ephemeral, offline.** Bind 127.0.0.1 on port 0 and read the port the OS assigned.
//     Readiness comes from the server's own `listening` event, never from a pause: the same code
//     runs on Windows, Linux and macOS, and nothing here uses a signal, a fixed port or a clock.
//   - **No handle outlives the test.** Every server this module opens is closed in one `after` hook
//     (`helpers.ts` registers its cleanup the same way), so `node --test` is never left waiting on
//     a socket. `tests/live-server.test.ts` proves the process can still exit on its own.
//   - **A fixture is untrusted input** (AGENTS.md). The bytes in the folder are handed out as they
//     are; nothing served is parsed as code, evaluated, or rewritten, and the server never invents
//     a response body — a path the folder does not name answers 404 with nothing in it.
//   - **Nothing outside the folder.** A request target is split into segments and percent-decoded,
//     and a segment that is `.` or `..`, holds a separator or a NUL, looks like a drive or a glob, or
//     resolves outside the root is refused with a 404 that carries no body.
//   - **No new dependency.** `node:http`, `node:fs`, `node:path` and `node:test` are builtins.
//
// Deliberately not here: caching, conditional requests, ranges, TLS, HTTP/2, cookies, or any
// behaviour a real host has that a test has not asked for. Add a route field when a check needs one.

import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve, sep } from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";

import { makeSite } from "./helpers.js";

/** How one request target answers. The bytes always come from the folder; only the framing is here. */
export interface LiveRoute {
  /** Status code instead of 200. A `redirectTo` without one is 301. */
  readonly status?: number;
  /** Response headers added to the derived ones, overriding a header of the same name. */
  readonly headers?: Record<string, string>;
  /** Answer a redirect instead of the file. Relative hops resolve against the request target; an
   *  absolute address is handed over exactly as written, whatever host it names. */
  readonly redirectTo?: string;
}

/** One request the server saw, in the order it arrived. */
export interface LiveRequest {
  readonly method: string;
  /** The request target as the client wrote it, query string included. */
  readonly path: string;
  readonly headers: IncomingMessage["headers"];
}

export interface LiveServer {
  /** `http://127.0.0.1:<the port the OS gave us>` — the only address this server can be reached at. */
  readonly origin: string;
  readonly port: number;
  /** An absolute address for a request target: `url("/")`, `url("/docs/index.html")`. */
  url(path: string): string;
  readonly requests: readonly LiveRequest[];
  /** Stops listening, drops every connection, and resolves when the port is gone. Safe twice. */
  close(): Promise<void>;
}

export interface ServeOptions {
  /** Per-target behaviour, keyed by the path as the client writes it: `"/"`, `"/docs/"`, `"/a"`. */
  readonly routes?: Record<string, LiveRoute>;
  /** Extension-to-content-type entries added to (or overriding) the table below for this fixture. */
  readonly contentTypes?: Record<string, string>;
}

/**
 * What the harness calls a content type for a name. This is the harness's own table for tests, not
 * a product contract; an extension it does not list is served as opaque bytes.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".jsonld": "application/ld+json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

/** Statuses that carry no body, so a fixture asking for one gets the framing HTTP expects. */
const NO_BODY = new Set([101, 204, 304]);

const open: LiveServer[] = [];

/**
 * Close every server this module opened. The `after` hook below runs it when a test file ends; a test
 * can also call it itself, which is how `tests/live-server.test.ts` proves the registry works without
 * leaving a socket to hang the runner.
 */
export async function closeAll(): Promise<void> {
  for (const server of [...open]) await server.close();
}

after(closeAll);

/** Percent-decode a path segment; a malformed escape is left as written, so it cannot name a file. */
function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The segments of a request target, or null when one of them could name something outside `root`. */
function segmentsOf(target: string): string[] | null {
  if (!target.startsWith("/")) return null;
  const segments: string[] = [];
  for (const part of target.split("/")) {
    if (part === "") continue;
    const decoded = decode(part);
    if (decoded === "." || decoded === "..") return null;
    if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return null;
    if (decoded.includes(":") || decoded.includes("*") || decoded.includes("?") || decoded.includes("#")) return null;
    segments.push(decoded);
  }
  return segments;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The folder-relative file a target names, or null when it names none. The mapping is the one
 * ADR 0011 measured, read backwards so a folder laid out for a static host answers: `/` is
 * `index.html`, a directory is its `index.html`, and a name without an extension is an `.html` page.
 */
function fileFor(root: string, target: string): string | null {
  const segments = segmentsOf(target);
  if (segments === null) return null;
  const inside = (parts: readonly string[]): string | null => {
    const candidate = resolve(root, ...parts);
    if (candidate !== root && !candidate.startsWith(root + sep)) return null;
    return isFile(candidate) ? candidate : null;
  };
  if (segments.length === 0) return inside(["index.html"]);
  if (target.endsWith("/")) return inside([...segments, "index.html"]);
  const exact = inside(segments);
  if (exact !== null) return exact;
  const last = segments[segments.length - 1]!;
  if (!last.includes(".")) {
    const asHtml = inside([...segments.slice(0, -1), `${last}.html`]);
    if (asHtml !== null) return asHtml;
    return inside([...segments, "index.html"]);
  }
  return null;
}

function typeOf(name: string, contentTypes: Record<string, string>): string {
  const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "application/octet-stream";
  const extension = base.slice(dot).toLowerCase();
  return contentTypes[extension] ?? CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** Redirect targets are checked once, up front: a test that names an address must name a parseable one. */
function validateRoutes(routes: Record<string, LiveRoute>): void {
  for (const [target, route] of Object.entries(routes)) {
    if (route.redirectTo === undefined) continue;
    try {
      new URL(route.redirectTo, `http://127.0.0.1${target}`);
    } catch {
      throw new Error(`live fixture: the route for ${JSON.stringify(target)} redirects to ${JSON.stringify(route.redirectTo)}, which is not an address`);
    }
  }
  for (const route of Object.values(routes)) {
    if (route.status !== undefined && !Number.isInteger(route.status)) throw new Error("live fixture: a route status must be a whole number");
  }
}

/**
 * Serve `root` (a built-site folder, read-only) over HTTP on a loopback address the OS assigned.
 * Resolves once the server is listening, so the caller can request it immediately.
 */
export function serveFixture(root: string, options: ServeOptions = {}): Promise<LiveServer> {
  const routes = options.routes ?? {};
  const contentTypes = options.contentTypes ?? {};
  validateRoutes(routes);
  const requests: LiveRequest[] = [];
  // Set the moment the OS reports the port, and read only from the request handler below: a hop's
  // relative address has to be resolved against *this* server, port included.
  let origin = "http://127.0.0.1";
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const rawTarget = request.url ?? "/";
    requests.push({ method: request.method ?? "GET", path: rawTarget, headers: request.headers });
    const target = rawTarget.split("?")[0] ?? "/";
    const head = request.method === "HEAD";

    if (request.method !== "GET" && !head) {
      response.writeHead(405, { allow: "GET, HEAD", "content-length": "0" });
      response.end();
      return;
    }

    const route = routes[target];
    const extra = route?.headers ?? {};
    if (route?.redirectTo !== undefined) {
      // A path-valued hop becomes an address on this server, port included; an absolute one is
      // handed over as written, because deciding what a hop means is a check's job, not the harness's.
      const headers: Record<string, string> = { location: new URL(route.redirectTo, `${origin}${target}`).href, "content-length": "0", ...extra };
      response.writeHead(route.status ?? 301, headers);
      response.end();
      return;
    }

    const file = fileFor(root, target);
    if (file === null) {
      const headers: Record<string, string> = { "content-length": "0", ...extra };
      response.writeHead(route?.status ?? 404, headers);
      response.end();
      return;
    }

    const status = route?.status ?? 200;
    if (NO_BODY.has(status)) {
      response.writeHead(status, extra);
      response.end();
      return;
    }
    const bytes = readFileSync(file);
    const headers: Record<string, string> = { "content-type": typeOf(file, contentTypes), "content-length": String(bytes.byteLength), ...extra };
    if (head) {
      response.writeHead(status, headers);
      response.end();
      return;
    }
    response.writeHead(status, headers);
    response.end(bytes);
  });

  // Readiness comes from `listening` and nowhere else: the promise this resolves is what `serveFixture`
  // returns, so a caller that awaited it can request the server immediately — no pause, no retry, no clock.
  const listening = new Promise<LiveServer>((promiseResolve, promiseReject) => {
    server.once("error", promiseReject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      origin = `http://127.0.0.1:${port}`;
      let closed = false;
      const live: LiveServer = {
        origin,
        port,
        url: (path: string) => `${origin}${path}`,
        requests,
        close: () =>
          new Promise<void>((resolveClose) => {
            if (closed) {
              resolveClose();
              return;
            }
            closed = true;
            server.closeAllConnections();
            server.close(() => {
              const index = open.indexOf(live);
              if (index >= 0) open.splice(index, 1);
              resolveClose();
            });
          }),
      };
      open.push(live);
      promiseResolve(live);
    });
  });
  return listening;
}

/**
 * Write a built site to a temporary folder and serve it: the short way to give a check a live
 * fixture. The folder is removed by `helpers.ts` when the test file ends; the server closes in the
 * hook above.
 */
export async function serveSite(files: Record<string, string | Buffer>, options: ServeOptions = {}): Promise<LiveServer> {
  return serveFixture(makeSite(files), options);
}

/**
 * A folder under `fixtures/`, addressed from the built tests the way `helpers.ts` addresses the
 * report schema: four levels up from `packages/verify/dist/tests`. Harness callers serve a real
 * fixture read-only; they never write it, and no ground truth moves.
 */
export function fixtureRoot(...parts: readonly string[]): string {
  return fileURLToPath(new URL(`../../../../fixtures/${parts.join("/")}`, import.meta.url));
}
