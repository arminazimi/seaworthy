import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlMetaRefresh } from "../src/checks/meta.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (head: string) => `<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body><h1>t</h1></body>\n</html>\n`;

async function findings(head: string) {
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE(head) })), checks: [htmlMetaRefresh] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("html.meta-refresh reports redirects and reloads with a delay", async () => {
  const result = await findings('\n  <meta http-equiv="refresh" content="5; url=/next.html">\n  <meta http-equiv="refresh" content="1">\n');
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((f) => [f.location.line, f.location.column]), [[4, 30], [5, 30]]);
  assert.match(result[0]!.message, /redirects to \/next\.html after 5 seconds/);
  assert.match(result[1]!.message, /reloads itself after 1 second/);
  assert.ok(result.every((f) => f.checkId === "html.meta-refresh" && f.severity === "warning" && f.fix.kind === "manual" && f.fix.edits.length === 0));
});

test("html.meta-refresh ignores an immediate refresh and values browsers do not act on", async () => {
  const tags = [
    '<meta http-equiv="refresh" content="0; url=/next.html">',
    '<meta http-equiv="refresh" content="0">',
    '<meta http-equiv="refresh">',
    '<meta http-equiv="refresh" content="">',
    '<meta http-equiv="refresh" content="soon; url=/next.html">',
    '<meta http-equiv="refresh" content="+5; url=/next.html">',
    '<meta http-equiv="refresh" content="0.5; url=/next.html">',
    '<meta http-equiv="refresh" content="5, url=/next.html">',
    '<meta http-equiv="refresh" content="5; url">',
    '<meta http-equiv="X-UA-Compatible" content="5">',
    '<meta name="refresh" content="5">',
  ].join("\n");
  assert.deepEqual(await findings(`\n${tags}\n`), []);
});

test("html.meta-refresh accepts mixed case and whitespace around the delay and url", async () => {
  const result = await findings('\n  <meta HTTP-EQUIV="Refresh" content=" 10 ; URL = /next.html ">\n');
  assert.equal(result.length, 1);
  assert.match(result[0]!.message, /redirects to \/next\.html after 10 seconds/);
});

test("html.meta-refresh fingerprints a refresh by its content, not its line", async () => {
  const tag = '<meta http-equiv="refresh" content="5">';
  const [before] = await findings(`\n${tag}\n`);
  const [after] = await findings(`\n<p>more content</p>\n${tag}\n`);
  assert.equal(before!.fingerprint, after!.fingerprint);
});
