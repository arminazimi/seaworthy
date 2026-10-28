// Proves that a default verify run makes no network requests: every network surface
// Node exposes is replaced with a recorder during one full default verify over a fixture,
// and the test fails if anything opens a socket, listens, resolves DNS, or calls fetch.
//
// Dedicated test file on purpose: `node --test` runs each file in its own process, so the
// patches here cannot leak into other tests. Patches are also restored in a `finally`.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { builtInChecks } from "../src/checks/index.js";
import { verifySite } from "../src/verify.js";
import { makeSite } from "./helpers.js";

const require_ = createRequire(import.meta.url);
// Accessing the built-ins through `createRequire` gives the live module objects, so patching
// their exports reaches CommonJS callers; the class-prototype patches cover the rest.
type Surface = Record<PropertyKey, any>;

const net = require_("node:net") as Surface;
const tls = require_("node:tls") as Surface;
const http = require_("node:http") as Surface;
const https = require_("node:https") as Surface;
const http2 = require_("node:http2") as Surface;
const dgram = require_("node:dgram") as Surface;
const dns = require_("node:dns") as Surface;

const attempts: string[] = [];
const patched: { target: Surface; key: PropertyKey; original: unknown }[] = [];

/** Replaces `target[key]` with a recorder that throws, so a stray request never leaves the process. */
function block(target: Surface, key: PropertyKey, surface: string, isMethod = false): void {
  const original = target[key];
  if (typeof original !== "function") throw new Error(`cannot block ${surface}: no function ${String(key)}`);
  patched.push({ target, key, original });
  target[key] = isMethod
    ? function (this: unknown, ...args: unknown[]): never {
        attempts.push(`${surface} (${String(args[0])})`);
        throw new Error(`network is blocked in tests: ${surface}`);
      }
    : (...args: unknown[]): never => {
        attempts.push(`${surface} (${String(args[0])})`);
        throw new Error(`network is blocked in tests: ${surface}`);
      };
}

// Any TCP connect is recorded here, which covers net.connect, http.request, https.request,
// tls.connect, and everything built on top of them.
block(net, "connect", "net.connect");
block(net, "createConnection", "net.createConnection");
block(net.Socket.prototype as Surface, "connect", "Socket.connect", true);
block(net.Server.prototype as Surface, "listen", "Server.listen", true);

block(tls, "connect", "tls.connect");

// DNS lookups reach the resolver without a JS-visible socket, so every entry point is recorded.
const dnsNames = ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse"];
for (const name of dnsNames) block(dns, name, `dns.${name}`);
for (const name of dnsNames) block(dns.promises as Surface, name, `dns.promises.${name}`);

for (const name of ["request", "get"]) block(http, name, `http.${name}`);
for (const name of ["request", "get"]) block(https, name, `https.${name}`);
block(http2, "connect", "http2.connect");
block(dgram, "createSocket", "dgram.createSocket");

// fetch (and undici under it) sits above http/https and must be blocked on its own.
patched.push({ target: globalThis, key: "fetch", original: globalThis.fetch });
globalThis.fetch = (...args: unknown[]): never => {
  attempts.push(`fetch (${String(args[0])})`);
  throw new Error("network is blocked in tests: fetch");
};

function unblock(): void {
  for (const { target, key, original } of patched.reverse()) target[key] = original;
  patched.length = 0;
}

const PAGE = (extra = "") => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>t</title></head>\n<body>\n${extra}<img src="/a.png"> <a href="/about.html">about</a> <a href="https://example.test">external</a>\n</body></html>\n`;

test("a default verify of a fixture opens no sockets or DNS lookups", async () => {
  const folder = makeSite({
    "index.html": PAGE(),
    "about.html": PAGE('<script src="https://cdn.example.test/x.js"></script><img src="https://cdn.example.test/a.png" alt="x">'),
    "robots.txt": "User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap.xml\n",
    "sitemap.xml": '<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/</loc></url><url><loc>https://example.test/about.html</loc></url></urlset>\n',
    "llms.txt": "# Site\n\n> t\n\n## Pages\n\n- [index](https://example.test/)\n",
  });

  // The fixture is full of external hosts on purpose: any check quietly fetching them
  // is caught by the recorders. Passing neither `network` nor `rendered` is the point.
  let thrown: unknown;
  try {
    const result = await verifySite({ folder, rootLabel: "dist", checks: builtInChecks, now: new Date("2027-02-01T00:00:00Z") });
    assert.deepEqual(result.report.errors, [], "no check may need the network to run: a check that needs it is skipped, never passed silently");
    assert.ok(result.report.checks.length > builtInChecks.length, "the checks actually ran");
  } catch (error) {
    thrown = error;
  } finally {
    unblock();
  }
  if (thrown !== undefined) {
    assert.deepEqual(attempts, [], `the run touched the network on: ${[...new Set(attempts)].join(", ")}`);
    throw thrown;
  }
  assert.deepEqual(attempts, []);
});
