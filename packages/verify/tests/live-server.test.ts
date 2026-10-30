// The live-fixture server, proved (issue #316): a built site served over real HTTP on an ephemeral
// loopback port, inside the test process. Every test here is offline and deterministic — readiness
// comes from the server's own `listening` event, no port is fixed, nothing waits on a clock, and no
// POSIX-only trick is used, so the same file runs on Windows, Linux and macOS. Servers are closed by
// the harness's own `after` hook; the one child-process test below is the proof that nothing is left
// holding the test runner open.
//
// What is NOT tested here, because it is not this harness's: any HTTP check's findings (#308, #311),
// discovery and robots.txt, and the `verify <url>` command.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { fetchLiveSite } from "../src/fetch-site.js";
import { closeAll, fixtureRoot, serveFixture, serveSite } from "./live-server.js";
import { makeSite } from "./helpers.js";

const page = (body: string): string =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>A page</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

const bytes = async (response: Response): Promise<Buffer> => Buffer.from(await response.arrayBuffer());

/**
 * Put a request target on the wire exactly as written: `node:http` sends this path in the request
 * line without resolving `.` or `..` first, which is how the server's own guard gets tested rather
 * than a URL parser's. One connection, closed as soon as the answer is read.
 */
function raw(path: string, port: number): Promise<{ status: number; body: Buffer }> {
  return new Promise((requestResolve, requestReject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => requestResolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
      response.on("error", requestReject);
    });
    request.on("error", requestReject);
    request.end();
  });
}

/** The temp folders this file makes by hand, rather than through `makeSite`. */
const scratch: string[] = [];
after(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true });
});

test("it listens on an address the OS gave it and is reachable the moment listen resolves", async () => {
  const first = await serveSite({ "index.html": page("<p>one</p>") });
  const response = await fetch(first.url("/"));
  assert.equal(response.status, 200, "no pause, no retry: the first request after the await already works");
  assert.match(first.origin, /^http:\/\/127\.0\.0\.1:\d+$/, "a loopback address literal, so no name is ever looked up");
  assert.equal(first.port > 0 && first.port < 65536, true, `an ephemeral port (${first.port}), never a fixed one`);
  assert.equal(first.url("/x.html"), `${first.origin}/x.html`);

  // A second fixture on its own port: two tests, or two sites in one test, cannot collide.
  const second = await serveSite({ "index.html": page("<p>two</p>") });
  assert.notEqual(second.port, first.port);
  assert.equal((await bytes(await fetch(second.url("/")))).includes("<p>two</p>"), true);
  assert.equal((await bytes(await fetch(first.url("/")))).includes("<p>one</p>"), true);

  await first.close();
  await second.close();
  assert.deepEqual(first.requests.map((request) => request.path), ["/", "/"], "each request the client made is logged, in order");
  assert.deepEqual(second.requests.map((request) => request.path), ["/"]);
});

test("the bytes handed out are the bytes in the folder, and a script in them stays text", async () => {
  // A fixture is untrusted input (AGENTS.md): the harness serves it, it does not run it. Nothing here
  // executes anything, and the body that comes back is the file, byte for byte, script tag included.
  const files = { "index.html": page('<script>window.attacked = true</script><p>plain</p>') };
  const root = makeSite(files);
  const server = await serveFixture(root);
  try {
    const response = await fetch(server.url("/index.html"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8", "a stated content type, not a sniffed one");
    const body = await bytes(response);
    assert.ok(body.equals(readFileSync(join(root, "index.html"))), "served as it is stored");
    assert.equal(response.headers.get("content-length"), String(body.byteLength));
  } finally {
    await server.close();
  }
});

test("the content type comes from the name, and a name the table does not list is opaque bytes", async () => {
  const server = await serveSite(
    {
      "index.html": page("<p>html</p>"),
      "site.css": "body{color:red}",
      "app.js": "console.log(1)",
      "data.json": '{"a":1}',
      "sitemap.xml": "<urlset/>",
      "robots.txt": "User-agent: *\n",
      "docs.md": "# hi",
      "icon.svg": "<svg/>",
      "logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      "mystery.weird": "what is this",
    },
    { contentTypes: { ".weird": "application/x-seaworthy-test" } },
  );
  try {
    const typeOf = async (path: string): Promise<string | null> => (await fetch(server.url(path))).headers.get("content-type");
    assert.equal(await typeOf("/index.html"), "text/html; charset=utf-8");
    assert.equal(await typeOf("/site.css"), "text/css; charset=utf-8");
    assert.equal(await typeOf("/app.js"), "text/javascript; charset=utf-8");
    assert.equal(await typeOf("/data.json"), "application/json");
    assert.equal(await typeOf("/sitemap.xml"), "application/xml");
    assert.equal(await typeOf("/robots.txt"), "text/plain; charset=utf-8");
    assert.equal(await typeOf("/docs.md"), "text/markdown; charset=utf-8");
    assert.equal(await typeOf("/icon.svg"), "image/svg+xml");
    assert.equal(await typeOf("/mystery.weird"), "application/x-seaworthy-test", "a test may state a type of its own");
    // Without the override the same name is opaque bytes: the harness does not guess.
    const plain = await serveSite({ "mystery.weird": "what is this" });
    try {
      assert.equal((await fetch(plain.url("/mystery.weird"))).headers.get("content-type"), "application/octet-stream");
      assert.equal((await fetch(server.url("/index.html"))).status, 200, "the first server still answers while the second is open");
    } finally {
      await plain.close();
    }
  } finally {
    await server.close();
  }
});

test("a directory and an extension-less name answer the file the ADR mapping names", async () => {
  const files = { "index.html": page("<p>root</p>"), "docs/index.html": page("<p>docs</p>"), "about.html": page("<p>about</p>") };
  const server = await serveSite(files);
  try {
    for (const [path, expected] of [
      ["/", "root"],
      ["/docs/", "docs"],
      ["/docs", "docs"],
      ["/about", "about"],
      ["/about.html", "about"],
    ] as const) {
      const response = await fetch(server.url(path));
      assert.equal(response.status, 200, path);
      assert.equal((await bytes(response)).includes(`<p>${expected}</p>`), true, `${path} is served as ${expected}`);
    }
  } finally {
    await server.close();
  }
});

test("a path the folder does not name answers 404 and invents no body", async () => {
  const server = await serveSite({ "index.html": page("<p>here</p>") });
  try {
    for (const path of ["/nope.html", "/docs/missing.html", "/nothing"]) {
      const response = await fetch(server.url(path));
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get("content-length"), "0", `${path}: nothing is written for a page the fixture does not have`);
      assert.equal((await bytes(response)).byteLength, 0, path);
    }
  } finally {
    await server.close();
  }
});

test("a route answers with the status and the headers the test states", async () => {
  const server = await serveSite(
    {
      "boom.html": page("<p>failed</p>"),
      "cached.html": page("<p>stale</p>"),
      "gone.html": page("<p>never sent</p>"),
    },
    {
      routes: {
        "/boom.html": { status: 500, headers: { "x-reason": "upstream said no", "retry-after": "120" } },
        "/cached.html": { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "max-age=0, must-revalidate" } },
        "/gone.html": { status: 204 },
      },
    },
  );
  try {
    const boom = await fetch(server.url("/boom.html"));
    assert.equal(boom.status, 500);
    assert.equal(boom.headers.get("x-reason"), "upstream said no");
    assert.equal(boom.headers.get("retry-after"), "120");
    assert.ok((await bytes(boom)).includes("<p>failed</p>"), "the bytes are still the fixture's own");

    const cached = await fetch(server.url("/cached.html"));
    assert.equal(cached.status, 200);
    assert.equal(cached.headers.get("content-type"), "text/plain; charset=utf-8", "a stated header wins over the derived one");
    assert.equal(cached.headers.get("cache-control"), "max-age=0, must-revalidate");

    const gone = await fetch(server.url("/gone.html"));
    assert.equal(gone.status, 204);
    assert.equal(gone.headers.get("content-length"), null, "a status that carries no body gets none, even from a file that has one");
    assert.equal((await bytes(gone)).byteLength, 0);
  } finally {
    await server.close();
  }
});

test("redirects: 301 by default, a stated status, a relative hop, and a chain ending in bytes", async () => {
  const server = await serveSite(
    { "target.html": page("<p>landed</p>"), "deep/page.html": page("<p>deep</p>"), "other.html": page("<p>other</p>") },
    {
      routes: {
        "/a": { redirectTo: "/b" },
        "/b": { redirectTo: "/target.html", status: 302 },
        "/deep/page.html": { redirectTo: "../other.html" },
      },
    },
  );
  try {
    const moved = await fetch(server.url("/a"), { redirect: "manual" });
    assert.equal(moved.status, 301, "a hop with no stated status is a permanent redirect");
    assert.equal(moved.headers.get("location"), server.url("/b"), "a path-valued hop is answered as an absolute address on this server");

    const found = await fetch(server.url("/a"));
    assert.equal(found.status, 200);
    assert.ok((await bytes(found)).includes("<p>landed</p>"), "following the chain reaches the fixture's bytes");

    const relative = await fetch(server.url("/deep/page.html"), { redirect: "manual" });
    assert.equal(relative.headers.get("location"), server.url("/other.html"), "a relative hop is resolved against the request target");
    assert.ok((await bytes(await fetch(server.url("/deep/page.html")))).includes("<p>other</p>"));
    assert.deepEqual(
      server.requests.map((request) => request.path),
      ["/a", "/a", "/b", "/target.html", "/deep/page.html", "/deep/page.html", "/other.html"],
      "every hop is logged in the order it was asked, once per request",
    );
  } finally {
    await server.close();
  }
});

test("a redirect to another host is handed over as written, not rewritten or dropped", async () => {
  const server = await serveSite({ "x.html": page("<p>x</p>") }, { routes: { "/out": { redirectTo: "https://elsewhere.example/y", status: 308 } } });
  try {
    const response = await fetch(server.url("/out"), { redirect: "manual" });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "https://elsewhere.example/y", "the harness is not the one deciding what a hop means");
  } finally {
    await server.close();
  }
});

test("nothing outside the served folder is reachable, however the target is written", async () => {
  const parent = mkdtempSync(join(tmpdir(), "seaworthy-live-outside-"));
  scratch.push(parent);
  const site = join(parent, "site");
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, "index.html"), page("<p>served</p>"));
  writeFileSync(join(parent, "secret.txt"), "a file one level up, never to be served");
  writeFileSync(join(parent, "docs.html"), "an html file one level up");

  const server = await serveFixture(site);
  try {
    // A URL parser resolves `..` before a client ever sends it, so these arrive as ordinary paths:
    // the claim a browser-based check can make is simply that the neighbour's bytes never come back.
    for (const path of ["/../secret.txt", "/a/../../secret.txt", "/%2e%2e/secret.txt", "/%2e%2e", "/docs.html/../../secret.txt"]) {
      const response = await fetch(server.url(path));
      const body = await bytes(response);
      assert.equal(body.includes("never to be served"), false, `${path} gives nothing from outside`);
      assert.equal(body.includes("an html file one level up"), false, `${path} gives nothing from outside`);
    }
    // The server's own guard, tested by putting a target on the wire exactly as written: no
    // normalization happens first, so this is the harness answering, not the client.
    const attempts = ["/../secret.txt", "/..%2Fsecret.txt", "/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt", "/a/../../secret.txt", "/..%5Csecret.txt", "/./../secret.txt", "/index.html/../secret.txt", "/%2e%2e", "///secret.txt"];
    for (const path of attempts) {
      const answer = await raw(path, server.port);
      assert.equal(answer.status, 404, `${path} is refused`);
      assert.equal(answer.body.byteLength, 0, `${path} returns nothing at all, so it leaks nothing`);
    }
    const served = await fetch(server.url("/index.html"));
    assert.ok((await bytes(served)).includes("<p>served</p>"), "the folder itself is still served");
    assert.equal(server.requests.length, 5 + attempts.length + 1, "and every attempt is logged, none of them answered from outside the folder");
  } finally {
    await server.close();
  }
});

test("a query string never changes the bytes and is logged as the client wrote it", async () => {
  const server = await serveSite({ "index.html": page("<p>same</p>") }, { routes: { "/tracked.html": { redirectTo: "/index.html?from=route" } } });
  try {
    const plain = await bytes(await fetch(server.url("/index.html")));
    const withQuery = await bytes(await fetch(server.url("/index.html?v=2&x=y")));
    assert.ok(withQuery.equals(plain), "the same file answers, whatever the caller asked around it");
    assert.equal(server.requests[1]!.path, "/index.html?v=2&x=y", "the target is recorded exactly as it arrived");
    assert.equal(server.requests[0]!.path, "/index.html");

    // A route keyed on the path still answers when the client appends a query.
    const tracked = await fetch(server.url("/tracked.html?a=1"), { redirect: "manual" });
    assert.equal(tracked.headers.get("location"), `${server.origin}/index.html?from=route`, "a stated hop keeps its own query, not the request's");
  } finally {
    await server.close();
  }
});

test("only GET and HEAD are served, and HEAD carries the length without the body", async () => {
  const files = { "index.html": page("<p>body</p>") };
  const server = await serveSite(files);
  try {
    const head = await fetch(server.url("/index.html"), { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(head.headers.get("content-length"), String(Buffer.byteLength(files["index.html"]!)), "the length is stated so a client can plan");
    assert.equal((await bytes(head)).byteLength, 0, "and nothing is sent");

    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await fetch(server.url("/index.html"), { method, body: "" });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get("allow"), "GET, HEAD", method);
      assert.equal((await bytes(response)).byteLength, 0, method);
    }
    assert.deepEqual(server.requests.map((request) => request.method), ["HEAD", "POST", "PUT", "DELETE"]);
  } finally {
    await server.close();
  }
});

test("every request is logged in order with its method, target and headers", async () => {
  const server = await serveSite({ "index.html": page("<p>log</p>"), "a.css": "a{}" });
  try {
    await fetch(server.url("/index.html"), { headers: { "x-first": "yes" } });
    await fetch(server.url("/a.css"), { method: "HEAD" });
    await fetch(server.url("/missing.html")).catch(() => undefined);
    assert.deepEqual(
      server.requests.map((request) => [request.method, request.path]),
      [["GET", "/index.html"], ["HEAD", "/a.css"], ["GET", "/missing.html"]],
    );
    assert.equal(server.requests[0]!.headers["x-first"], "yes", "what the client sent is what the test can assert");
    assert.equal(typeof server.requests[1]!.headers.host, "string", "the Host header, so a check can prove what address it thinks it is talking to");
    assert.equal(server.requests[1]!.headers["user-agent"], "node", "no identity is invented for the client");
  } finally {
    await server.close();
  }
});

test("close() takes the address away, and closing twice changes nothing", async () => {
  const server = await serveSite({ "index.html": page("<p>gone soon</p>") });
  const address = server.url("/index.html");
  assert.equal((await fetch(address)).status, 200);
  await server.close();
  await assert.rejects(fetch(address), "the port is gone, so a later test cannot read a stale fixture");
  await server.close();
  assert.deepEqual(server.requests.map((request) => request.path), ["/index.html"], "the log survives, so it can still be asserted");
});

test("a process that opens a harness server, serves from it and closes it exits on its own", async () => {
  // The handle-leak proof that is not a wall-clock guess: this child does the documented thing
  // (open, serve a redirect chain, close) and then stops. If the harness left a listening socket or a
  // connection ref'd, the child would never exit and `execFile` would report its timeout rather than
  // an exit code — a failed test instead of a hung CI job.
  const harness = new URL("./live-server.js", import.meta.url).href;
  const script = `(async () => {
  const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const root = mkdtempSync(join(tmpdir(), "seaworthy-live-exit-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><p>hi</p>");
  const { serveFixture } = await import(${JSON.stringify(harness)});
  const server = await serveFixture(root, { routes: { "/moved": { redirectTo: "/index.html" } } });
  const hop = await fetch(server.url("/moved"));
  const body = await hop.text();
  await server.close();
  rmSync(root, { recursive: true, force: true });
  console.log("served " + server.port + " " + server.requests.length + " " + body.includes("<p>hi</p>"));
})().catch((error) => { console.error(error && error.stack); process.exitCode = 1; });
`;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["-e", script], { timeout: 30_000, encoding: "utf8" });
  assert.equal(stderr, "");
  // node:test is loaded by the harness, so a bare `node -e` run also prints its TAP report; the line
  // asserted here is the child's own, printed after the server was closed.
  assert.match(stdout, /^served \d+ 2 true$/m, "the hop was followed to the fixture's bytes, then the process ended by itself");
});

test("the harness's own teardown closes a server a test forgot", async () => {
  // Forgetting `close()` must not be able to hang the runner: `closeAll()` is the very function the
  // module registers as its `after` hook, so calling it here proves the registry closes what it opened.
  const first = await serveSite({ "index.html": page("<p>one</p>") });
  const second = await serveSite({ "index.html": page("<p>two</p>") });
  const addresses = [first.url("/index.html"), second.url("/index.html")];
  for (const address of addresses) assert.equal((await fetch(address)).status, 200);
  await closeAll();
  for (const address of addresses) await assert.rejects(fetch(address), "no socket is left listening");
  await closeAll();
});

test("a real fixture folder is served read-only, byte for byte as fixtures/ holds it", async () => {
  const root = fixtureRoot("clean", "minimal", "site");
  const indexBefore = readFileSync(join(root, "index.html"));
  const server = await serveFixture(root);
  try {
    const response = await fetch(server.url("/index.html"));
    assert.equal(response.status, 200);
    assert.ok((await bytes(response)).equals(indexBefore), "the same bytes the folder holds");
    assert.equal((await fetch(server.url("/"))).status, 200, "a fixture's own index answers at /");
    assert.equal((await fetch(server.url("/sitemap.xml"))).headers.get("content-type"), "application/xml");
    assert.equal((await fetch(server.url("/not-in-the-fixture.html"))).status, 404);
  } finally {
    await server.close();
  }
  assert.ok(readFileSync(join(root, "index.html")).equals(indexBefore), "serving a fixture never changes it");
});

test("it serves the live path it was built for: fetchLiveSite reads a served tree", async () => {
  const files = { "index.html": page('<a href="/docs/">docs</a>'), "docs/index.html": page("<p>docs</p>") };
  const server = await serveSite(files);
  const live = await fetchLiveSite([server.url("/"), server.url("/docs/")]);
  try {
    assert.deepEqual(live.refused, []);
    assert.equal(live.origin, server.origin, "labelled by the loopback address it came from");
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["index.html", "docs/index.html"]);
    assert.equal(live.site.pageFor("/docs/index.html")?.source.includes("<p>docs</p>"), true, "the bytes the harness served are the bytes the graph parsed");
  } finally {
    live.remove();
    await server.close();
  }
});
