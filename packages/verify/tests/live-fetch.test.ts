// --fetch: pages pulled over HTTP enter the same site graph a folder run builds (ADR 0011).
//
// Every test here runs against a server on an ephemeral loopback port inside this process: bind
// port 0, read the port the OS assigned, close the server and its connections in `after`. No
// public host is ever named, and no test needs the internet. The flag-off half of the contract is
// guarded by `fixtures.test.ts` (ground truth, untouched) and `offline.test.ts` (no socket on the
// default path); test "with the flag absent" below adds the CLI-level byte-for-byte claim.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, test } from "node:test";

import { runChecks } from "../src/engine.js";
import { DEFAULT_FETCH_LIMITS, LIVE_USER_AGENT, fetchLiveSite, type FetchSiteOptions, type LiveSite } from "../src/fetch-site.js";
import { builtInChecks } from "../src/checks/index.js";
import { linksInternal } from "../src/checks/links.js";
import { run, EXIT } from "../src/cli.js";
import { verifySite } from "../src/verify.js";
import type { Report } from "../src/types.js";
import { makeSite, reportErrors } from "./helpers.js";

const NOW = new Date("2027-03-01T00:00:00Z");
const page = (body: string): string => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>A page</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

// --------------------------------------------------------------------------------------------
// The local server. One per test, all closed in `after`, so no handle outlives the file.
// --------------------------------------------------------------------------------------------

interface Stubbed {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /** The whole body, sent with its Content-Length. */
  readonly body?: string;
  /** Body pieces, sent chunked, so a client that trusts Content-Length alone is caught out. */
  readonly chunks?: string[];
  /** Wait this long before answering, so a timeout can be observed. */
  readonly delayMs?: number;
}

interface Stub {
  /** `http://127.0.0.1:<the port the OS gave us>`. */
  readonly origin: string;
  readonly url: (path: string) => string;
  /** Every request the site saw, in order, with its path as written. */
  readonly requests: { path: string; headers: IncomingMessage["headers"] }[];
  close(): Promise<void>;
}

const open: Stub[] = [];

function serve(routes: Record<string, Stubbed>): Promise<Stub> {
  const requests: Stub["requests"] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const target = request.url ?? "/";
    requests.push({ path: target, headers: request.headers });
    const route = routes[target.split("?")[0] as string];
    const send = (): void => {
      if (response.writableEnded || response.destroyed) return;
      if (route === undefined) {
        response.writeHead(404, { "content-type": "text/html", "x-note": "no such page" });
        response.end(page("<p>Nothing here.</p>"));
        return;
      }
      response.writeHead(route.status ?? 200, route.headers ?? {});
      if (route.chunks !== undefined) for (const chunk of route.chunks) response.write(chunk);
      response.end(route.body ?? "");
    };
    if (route?.delayMs === undefined) send();
    else {
      const timer = setTimeout(send, route.delayMs);
      // The client giving up closes the socket; without this the timer would outlive the test.
      response.on("close", () => clearTimeout(timer));
    }
  });
  return new Promise<Stub>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const stub: Stub = {
        origin,
        url: (path: string) => `${origin}${path}`,
        requests,
        close: () => new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      };
      open.push(stub);
      resolve(stub);
    });
  });
}

after(async () => {
  for (const stub of open) await stub.close();
});

// --------------------------------------------------------------------------------------------

/** Runs `work` on a live snapshot of `urls` and deletes the snapshot afterwards. */
async function withLive<T>(urls: readonly string[], work: (live: LiveSite) => Promise<T> | T, options: FetchSiteOptions = {}): Promise<T> {
  const live = await fetchLiveSite(urls, options);
  try {
    return await work(live);
  } finally {
    live.remove();
  }
}

test("a fetched page becomes a page in the graph, and a real check finds its broken link", async () => {
  const site = await serve({ "/": { headers: { "content-type": "text/html" }, body: page('<a href="/missing.html">gone</a>') } });
  await withLive([site.url("/")], async (live) => {
    assert.deepEqual(live.refused, [], "nothing was refused");
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["index.html"], "the directory URL is written as index.html");
    assert.equal(live.site.pages.has("/index.html"), true, "the graph parsed it as a page");
    assert.equal(live.origin, site.origin, "the run is labelled by the origin, never by a folder path");

    const result = await runChecks({ site: live.site, checks: [linksInternal] });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.findings.map((finding) => [finding.checkId, finding.location.file, finding.severity]), [["links.internal", "index.html", "error"]]);
    assert.match(result.findings[0]!.message, /missing\.html/);
    assert.ok(result.findings[0]!.location.line !== undefined, "the finding carries a line, so the source position came from the parser");
  });
});

test("the snapshot and the build folder give the same report byte for byte", async () => {
  // ADR 0011's equivalence result, asserted: the same bytes in the same graph are the same report.
  const files = {
    "index.html": page('<a href="/docs/">one</a> <a href="/docs/missing.html">gap</a>'),
    "docs/index.html": page('<a href="/../index.html">up</a>'),
  };
  const folder = makeSite(files);
  const site = await serve({
    "/": { headers: { "content-type": "text/html" }, body: files["index.html"] },
    "/index.html": { headers: { "content-type": "text/html" }, body: files["index.html"] },
    "/docs/": { headers: { "content-type": "text/html" }, body: files["docs/index.html"] },
    "/docs/index.html": { headers: { "content-type": "text/html" }, body: files["docs/index.html"] },
  });
  // The two forms the ADR names: a directory URL and an extension-less one both land on a page.
  const urls = [site.url("/"), site.url("/docs/")];

  const live = await fetchLiveSite(urls);
  try {
    assert.deepEqual(live.refused, []);
    const fromFolder = (await verifySite({ folder, rootLabel: "dist", checks: builtInChecks, now: NOW })).report;
    const fromFetch = (await verifySite({ folder: live.folder, site: live.site, rootLabel: live.origin, checks: builtInChecks, now: NOW })).report;

    assert.deepEqual(reportErrors(fromFetch), [], "a live report still matches the frozen schema");
    assert.equal(fromFetch.root, site.origin, "the root names the origin the pages came from");
    assert.deepEqual(
      fromFetch.findings.map((finding) => [finding.checkId, finding.location.file, finding.location.line, finding.location.column, finding.message, finding.fingerprint]),
      fromFolder.findings.map((finding) => [finding.checkId, finding.location.file, finding.location.line, finding.location.column, finding.message, finding.fingerprint]),
      "the same pages produce the same findings, at the same positions, with the same fingerprints",
    );
    // Everything but the labels: a finding's `prompt`, and the report's, name the root the run was
    // labelled with, so the two reports differ there by design and nowhere else.
    const unlabelled = (report: Report): unknown =>
      JSON.parse(JSON.stringify({ ...report, root: "", prompt: undefined, findings: report.findings.map((finding) => ({ ...finding, prompt: undefined })) }));
    assert.ok(fromFolder.findings.length > 0, "the site has findings, so the comparison says something");
    assert.deepEqual(unlabelled(fromFetch), unlabelled(fromFolder), "one report, one contract: no field was added for a live run");
  } finally {
    live.remove();
  }
});

test("a page that answers 404 is refused with its reason, and links to it are reported", async () => {
  const site = await serve({
    "/": { headers: { "content-type": "text/html" }, body: page('<a href="/gone.html">gone</a>') },
    "/gone.html": { status: 404, headers: { "content-type": "text/html" }, body: page("<p>No such page</p>") },
  });
  await withLive([site.url("/"), site.url("/gone.html")], async (live) => {
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["index.html"]);
    assert.equal(live.refused.length, 1);
    assert.match(live.refused[0]!.reason, /answers 404/);
    assert.equal(live.site.files.has("/gone.html"), false, "a missing page is absent, exactly as on a folder");

    const result = await runChecks({ site: live.site, checks: [linksInternal] });
    assert.match(result.findings[0]!.message, /gone\.html/, "the link to the 404 is the finding, like a folder run reports it");
  });
});

test("a non-HTML body is kept as a file and never parsed as a page", async () => {
  const site = await serve({
    "/data.json": { headers: { "content-type": "application/json" }, body: '{"a":1}' },
    "/style.css": { headers: { "content-type": "text/css" }, body: "body{color:red}" },
    "/feed": { headers: { "content-type": "application/atom+xml" }, body: "<feed/>" },
    // HTML at a name the graph would parse is fine; the mapping, not the header, decides.
    "/report.html": { headers: { "content-type": "text/html; charset=utf-8" }, body: page("<p>ok</p>") },
  });
  await withLive([site.url("/data.json"), site.url("/style.css"), site.url("/feed"), site.url("/report.html")], async (live) => {
    assert.deepEqual(live.fetched.map((entry) => [entry.file, entry.isPage]), [["data.json", false], ["style.css", false], ["report.html", true]]);
    assert.equal(live.site.files.has("/data.json"), true, "a fetched asset counts as served, so a link to it is not broken");
    assert.equal(live.site.pages.has("/data.json"), false, "and it is not a page");
    assert.equal(live.site.pageFor("/report.html")?.source.includes("<p>ok</p>"), true);
    assert.match(live.refused[0]!.reason, /application\/atom\+xml, not HTML/, "an address whose file would be HTML is refused when the body is not");
    assert.equal(live.refused[0]!.url, site.url("/feed"));
  });
});

test("redirects are followed inside the host, bounded, and a cross-host hop is recorded not followed", async () => {
  const routes: Record<string, Stubbed> = {
    "/a": { status: 301, headers: { location: "/b" } },
    "/b": { status: 302, headers: { location: "/c" } },
    "/c": { headers: { "content-type": "text/html" }, body: page("<p>landed</p>") },
    "/loop": { status: 301, headers: { location: "/loop" } },
    "/elsewhere": { status: 301, headers: { location: "http://localhost:8080/x" } },
    "/down": { status: 302, headers: { location: "javascript:alert(1)" } },
  };
  const site = await serve(routes);
  await withLive([site.url("/a")], async (live) => {
    assert.deepEqual(live.refused, []);
    assert.equal(live.fetched[0]!.file, "a.html", "the snapshot is keyed by the address that was named");
    assert.equal(live.fetched[0]!.finalUrl, site.url("/c"), "and the redirect it took is recorded, not lost");
    assert.equal(live.site.pages.has("/a.html"), true);
    assert.equal(live.site.pages.has("/c.html"), false, "the page is not filed twice");
  });
  await withLive([site.url("/loop")], async (live) => {
    assert.match(live.refused[0]!.reason, new RegExp(`still redirecting after ${DEFAULT_FETCH_LIMITS.maxRedirects} redirects`));
    assert.equal(site.requests.filter((request) => request.path === "/loop").length, DEFAULT_FETCH_LIMITS.maxRedirects + 1, "the chain stops at the cap, it does not spin");
  });
  await withLive([site.url("/elsewhere")], async (live) => {
    assert.match(live.refused[0]!.reason, /another host/);
  });
  await withLive([site.url("/down")], async (live) => {
    assert.match(live.refused[0]!.reason, /redirects to the javascript scheme, which is not fetched/);
  });
});

test("an over-size body is refused at the cap, whether it declares its length or not", async () => {
  const site = await serve({
    "/big.html": { headers: { "content-type": "text/html", "content-length": "300" }, body: page("<p>" + "x".repeat(260) + "</p>") },
    "/liar.html": { headers: { "content-type": "text/html" }, chunks: ["<p>", "y".repeat(200), "</p>"] },
    "/small.html": { headers: { "content-type": "text/html" }, body: page("<p>fits</p>") },
  });
  const limits = { maxBytes: 150 };
  await withLive([site.url("/big.html"), site.url("/liar.html"), site.url("/small.html")], async (live) => {
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["small.html"], "a page inside the cap still lands");
    assert.match(live.refused[0]!.reason, /over the 150-byte cap/);
    assert.match(live.refused[1]!.reason, /sends more than 150 bytes/, "a body that lies about its length is cut off while it streams");
  }, { limits });
});

test("the page cap is enforced on the list, not discovered by fetching anyway", async () => {
  const site = await serve({
    "/one.html": { headers: { "content-type": "text/html" }, body: page("<p>one</p>") },
    "/two.html": { headers: { "content-type": "text/html" }, body: page("<p>two</p>") },
    "/three.html": { headers: { "content-type": "text/html" }, body: page("<p>three</p>") },
  });
  await withLive([site.url("/one.html"), site.url("/two.html"), site.url("/three.html")], async (live) => {
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["one.html", "two.html"]);
    assert.match(live.refused[0]!.reason, /page cap of 2/);
    assert.deepEqual(site.requests.map((request) => request.path), ["/one.html", "/two.html"], "the URL past the cap is never requested");
  }, { limits: { maxPages: 2 } });
});

test("nothing is sent that could authenticate, and the identity we promise is the one on the wire", async () => {
  const site = await serve({ "/": { headers: { "content-type": "text/html" }, body: page("<p>hi</p>") } });
  await withLive([site.url("/")], () => undefined);
  const headers = site.requests[0]!.headers;
  assert.equal(headers.cookie, undefined, "no cookies");
  assert.equal(headers.authorization, undefined, "no credentials");
  assert.equal(headers["user-agent"], LIVE_USER_AGENT, "the ADR's user agent");
  assert.equal(LIVE_USER_AGENT.includes("Seaworthy/"), true);
});

test("a scheme that is not http(s), credentials in the address, and a private literal are refused before a socket opens", async () => {
  const site = await serve({ "/x.html": { headers: { "content-type": "text/html" }, body: page("<p>x</p>") } });
  await withLive(
    [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://127.0.0.1/x.html",
      "not a url",
      `http://user:pass@127.0.0.1:${(new URL(site.origin)).port}/x.html`,
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/x.html",
      "http://[fd00::1]/x.html",
      site.url("/x.html"),
    ],
    async (live) => {
      assert.equal(live.fetched.length, 1, "only the plain loopback address was fetched");
      assert.deepEqual(site.requests.map((request) => request.path), ["/x.html"], "a refused address never reaches a socket");
      assert.match(live.refused[0]!.reason, /uses the file scheme/);
      assert.match(live.refused[1]!.reason, /javascript/);
      assert.match(live.refused[4]!.reason, /is not a complete URL/);
      assert.match(live.refused[5]!.reason, /never sends credentials/);
      for (const index of [6, 7, 8]) assert.match(live.refused[index]!.reason, /private or link-local address/, live.refused[index]!.url);
    },
  );
});

test("--allow-private is the only way a private address literal is requested", async () => {
  const site = await serve({ "/": { headers: { "content-type": "text/html" }, body: page("<p>here</p>") } });
  // 0.0.0.0 is the unspecified address: refused by default, and on this machine it reaches the
  // same loopback server, so the allowance is proven by an actual fetch rather than by a message.
  const anywhere = site.origin.replace("127.0.0.1", "0.0.0.0");
  await withLive([anywhere], async (live) => {
    assert.equal(live.fetched.length, 0);
    assert.match(live.refused[0]!.reason, /private or link-local address/);
  });
  await withLive([anywhere], async (live) => {
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["index.html"], "--allow-private fetched it");
    assert.deepEqual(live.refused, []);
  }, { allowPrivate: true });
});

test("an address that is not a plain file name is refused, and a dot-dot is normalized away", async () => {
  const site = await serve({ "/ok.html": { headers: { "content-type": "text/html" }, body: page("<p>ok</p>") } });
  await withLive([site.url("/a%2Fb.html"), site.url("/..%5Cwindows.html"), site.url("/%2e%2e/ok.html")], async (live) => {
    // `%2e%2e` is a dot-dot to the URL parser, so it is resolved before this module ever sees a
    // path: what is left is the page the host serves, and nothing outside it can be named.
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["ok.html"]);
    assert.equal(live.refused.length, 2, "an encoded slash and an encoded backslash are not file names");
    for (const refusal of live.refused) assert.match(refusal.reason, /not a file name a snapshot can hold/, refusal.url);
    assert.deepEqual(site.requests.map((request) => request.path), ["/ok.html"], "a refused address never opens a socket");
  });
});

test("two addresses whose file is the same are one page, fetched once", async () => {
  const site = await serve({ "/a": { headers: { "content-type": "text/html" }, body: page("<p>a</p>") } });
  await withLive([site.url("/a"), site.url("/a?v=2"), site.url("/a#top")], async (live) => {
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["a.html"]);
    assert.equal(live.refused.length, 2, "the query and the fragment address are refused, not silently merged");
    assert.match(live.refused[0]!.reason, /one page, not two/);
    assert.deepEqual(site.requests.map((request) => request.path), ["/a"], "the second and third addresses were never requested");
  });
});

test("an aborted signal cancels the run, and every URL says so instead of vanishing", async () => {
  const site = await serve({
    "/one.html": { headers: { "content-type": "text/html" }, body: page("<p>one</p>") },
    "/slow.html": { headers: { "content-type": "text/html" }, body: page("<p>late</p>"), delayMs: 5_000 },
  });
  const controller = new AbortController();
  const pending = fetchLiveSite([site.url("/slow.html"), site.url("/one.html")], { signal: controller.signal });
  controller.abort();
  const live = await pending;
  try {
    assert.deepEqual(live.fetched, []);
    assert.equal(live.refused.length, 2);
    assert.match(live.refused[0]!.reason, /cancelled/);
    assert.match(live.refused[1]!.reason, /cancelled/);
  } finally {
    live.remove();
  }
});

test("one URL that answers too slowly is given up on at the stated budget", async () => {
  const site = await serve({
    "/slow.html": { headers: { "content-type": "text/html" }, body: page("<p>late</p>"), delayMs: 400 },
    "/quick.html": { headers: { "content-type": "text/html" }, body: page("<p>quick</p>") },
  });
  await withLive([site.url("/slow.html"), site.url("/quick.html")], async (live) => {
    assert.deepEqual(live.fetched.map((entry) => entry.file), ["quick.html"], "a slow page does not stop the rest");
    assert.match(live.refused[0]!.reason, /gave up after 0\.05 seconds/);
  }, { limits: { timeoutMs: 50 } });
});

test("the temporary snapshot is deleted by its owner and nothing is written elsewhere", async () => {
  const site = await serve({ "/": { headers: { "content-type": "text/html" }, body: page("<p>hi</p>") } });
  const cwd = makeSite({ "keep.txt": "untouched" });
  const live = await fetchLiveSite([site.url("/")]);
  assert.equal(live.site.pages.size, 1);
  assert.notEqual(live.folder, cwd);
  live.remove();
  assert.equal(existsSync(live.folder), false, "remove() deleted the snapshot");
  assert.equal(readFileSync(join(cwd, "keep.txt"), "utf8"), "untouched", "Seaworthy never edits the user's files");
});

// --------------------------------------------------------------------------------------------
// The CLI: the flag is opt-in, and with it absent nothing changes.
// --------------------------------------------------------------------------------------------

test("the CLI reports a live finding, and says on stderr what it refused", async () => {
  const site = await serve({
    "/": { headers: { "content-type": "text/html" }, body: page('<a href="/missing.html">gone</a>') },
    "/missing.html": { status: 404, headers: { "content-type": "text/html" }, body: page("<p>nope</p>") },
  });
  const cwd = makeSite({});
  const result = await run(["verify", "--format", "json", "--fetch", site.url("/"), "--fetch", site.url("/missing.html")], { cwd });
  assert.equal(result.code, EXIT.findings);
  assert.equal(result.stdout.startsWith("{"), true, "stdout is only the report");
  const report = JSON.parse(result.stdout);
  assert.deepEqual(reportErrors(report), [], "the report still matches the frozen v0 schema");
  assert.equal(report.root, site.origin, "the run is labelled by the origin");
  // `links.internal` is the finding the fetched page was fetched to prove; the page is a stub, so
  // the content checks fire alongside it — the same graph the folder checks read, the same findings.
  const linkFindings = report.findings.filter((finding: { checkId: string }) => finding.checkId === "links.internal");
  assert.equal(linkFindings.length, 1, "the broken link is reported once, by the check that owns it");
  assert.equal(linkFindings[0]!.location.file, "index.html", "the finding names the page inside the snapshot");
  assert.match(linkFindings[0]!.message, /missing\.html/);
  assert.ok(report.findings.length > 1, "the checks that run on a folder ran on the fetched page too");
  assert.match(result.stderr, /--fetch refused .*\/missing\.html: answers 404/);
  assert.match(result.stderr, /--fetch got 1 of 2 URLs/);
});

test("with the flag absent, a run makes exactly the bytes it made before", async () => {
  const files = { "index.html": page('<a href="/missing.html">gone</a>'), "docs/one.html": page("<p>one</p>") };
  const folder = makeSite(files);
  const site = await serve({
    "/": { headers: { "content-type": "text/html" }, body: files["index.html"] },
    "/docs/one.html": { headers: { "content-type": "text/html" }, body: files["docs/one.html"] },
  });
  const before = await run(["verify", folder, "--format", "json"], { cwd: folder });
  assert.equal(before.code, EXIT.findings);
  // A live run in the same process must leave nothing behind that a folder run can notice.
  const live = await run(["verify", "--format", "json", "--fetch", site.url("/")], { cwd: makeSite({}) });
  assert.equal(live.code, EXIT.findings);
  const after = await run(["verify", folder, "--format", "json"], { cwd: folder });
  assert.deepEqual([after.code, after.stdout, after.stderr], [before.code, before.stdout, before.stderr], "byte-identical to the run that never asked for the network");
  assert.doesNotMatch(after.stderr, /--fetch/);
  assert.equal(JSON.parse(after.stdout).root, ".", "the folder run is still labelled by the folder");
});

test("flags that only mean a folder on disk are refused under --fetch", async () => {
  const site = await serve({ "/": { headers: { "content-type": "text/html" }, body: page("<p>hi</p>") } });
  const folder = makeSite({ "index.html": page("<p>hi</p>") });
  const cases: string[][] = [
    ["verify", folder, "--fetch", site.url("/")],
    ["verify", "--fetch", site.url("/"), "--changed"],
    ["verify", "--fetch", site.url("/"), "--changed-since", "HEAD~1"],
    ["verify", "--fetch", site.url("/"), "--watch"],
  ];
  for (const argv of cases) {
    const result = await run(argv, { cwd: folder });
    assert.equal(result.code, EXIT.usage, argv.join(" "));
    assert.equal(result.stdout, "", argv.join(" "));
    assert.match(result.stderr, /^seaworthy: /, argv.join(" "));
    assert.equal(site.requests.length, 0, "a refused invocation opens no socket");
  }
});

test("a --fetch run rejected for another reason never asks the host", async () => {
  const site = await serve({ "/": { headers: { "content-type": "text/html" }, body: page("<p>hi</p>") } });
  // This conflict is checked inside the run, not by the --fetch guard, so it proves where the fetch
  // sits: after every way the invocation itself can be wrong.
  const result = await run(["verify", "--fetch", site.url("/"), "--new-only", "--no-history"], { cwd: makeSite({}) });
  assert.equal(result.code, EXIT.usage);
  assert.match(result.stderr, /--new-only/);
  assert.equal(site.requests.length, 0, "nothing was requested from a run that was never going to verify");
});

test("when not one address became a page the run fails instead of reporting an empty site", async () => {
  const site = await serve({ "/gone.html": { status: 404, headers: { "content-type": "text/html" }, body: page("<p>gone</p>") } });
  const result = await run(["verify", "--fetch", site.url("/gone.html"), "--fetch", "https://not a url"], { cwd: makeSite({}) });
  assert.equal(result.code, EXIT.usage);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /--fetch got no page to verify/);
  assert.match(result.stderr, /answers 404/);
});
