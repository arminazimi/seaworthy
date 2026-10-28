import assert from "node:assert/strict";
import { test } from "node:test";

import { qualityNotFoundPage } from "../src/checks/quality.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (head: string, body: string) => `<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body>${body}</body>\n</html>\n`;
const REAL_PAGE = PAGE('<title>Not found</title>', '<main><h1>Not found</h1><p><a href="/index.html">Home</a></p></main>');
const STUB_PAGE = PAGE('<title>Redirect</title>', '<meta http-equiv="refresh" content="0; url=/index.html">');

function findings(files: Record<string, string | Buffer>) {
  return runChecks({ site: buildSite(makeSite(files)), checks: [qualityNotFoundPage] });
}

test("quality.not-found-page reports a build without a 404 page", async () => {
  const result = await findings({ "index.html": PAGE("<title>home</title>", "<p>home</p>"), "about.html": PAGE("<title>a</title>", "<p>a</p>") });
  assert.deepEqual(result.errors, []);
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0]!;
  assert.equal(finding.checkId, "quality.not-found-page");
  assert.equal(finding.severity, "warning");
  assert.deepEqual(finding.location, { file: "404.html" });
  assert.match(finding.message, /no 404 page/);
  assert.equal(finding.fix.kind, "manual");
  assert.equal(finding.fix.edits.length, 0);
  assert.match(finding.fix.summary, /404\.html/);
});

test("quality.not-found-page passes when 404.html is a real page", async () => {
  const result = await findings({ "index.html": PAGE("<title>home</title>", "<p>home</p>"), "404.html": REAL_PAGE });
  assert.deepEqual(result.findings, []);
});

test("quality.not-found-page accepts 404/index.html as the 404 page", async () => {
  const result = await findings({ "index.html": PAGE("<title>home</title>", "<p>home</p>"), "404/index.html": REAL_PAGE });
  assert.deepEqual(result.findings, []);
});

test("quality.not-found-page reports a 404 page that only redirects", async () => {
  const result = await findings({ "index.html": PAGE("<title>home</title>", "<p>home</p>"), "404.html": STUB_PAGE });
  assert.deepEqual(result.errors, []);
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0]!;
  assert.equal(finding.location.file, "404.html");
  assert.match(finding.message, /only redirects elsewhere/);
  assert.match(finding.fix.summary, /Replace the redirect/);
});

test("quality.not-found-page reports an empty 404 page", async () => {
  const empty = `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>404</title>\n  <script src="/app.js"></script>\n</head>\n<body>\n  <div id="app"></div>\n  <style>body { margin: 0 }</style>\n</body>\n</html>\n`;
  const result = await findings({ "index.html": PAGE("<title>home</title>", "<p>home</p>"), "404.html": empty });
  assert.deepEqual(result.errors, []);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0]!.message, /no visible content/);
});

test("quality.not-found-page fingerprints a redirect stub by its problem, not its line", async () => {
  const [before] = (await findings({ "index.html": PAGE("<title>home</title>", "<p>home</p>"), "404.html": STUB_PAGE })).findings;
  const [after] = (await findings({ "index.html": PAGE("<title>home</title>", "<p>home</p>"), "404.html": PAGE('\n<title>Redirect</title>\n<b>bold</b>', '<meta http-equiv="refresh" content="0; url=/index.html">') })).findings;
  assert.equal(after!.fingerprint, before!.fingerprint);
});
