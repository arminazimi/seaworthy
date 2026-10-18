import assert from "node:assert/strict";
import { test } from "node:test";

import { readabilityLlmsTxt } from "../src/checks/readability.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>t</h1></main></body></html>';

async function run(files: Record<string, string>, checks = [readabilityLlmsTxt]) {
  const result = await runChecks({ site: buildSite(makeSite({ "index.html": PAGE, ...files })), checks });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("readability.llms-txt: a missing file is only a note", async () => {
  const [finding, ...rest] = await run({});
  assert.equal(rest.length, 0);
  assert.equal(finding!.severity, "note");
  assert.match(finding!.message, /no llms\.txt/);
});

test("readability.llms-txt accepts a file that follows the proposal", async () => {
  const text = "# Site\n\n> Summary.\n\nProse is fine here.\n\n## Docs\n\n- [A](/a.md): notes\n- [B](https://other.test/b)\n- [C](/a.md \"title\")\n\n## Optional\n\n- [D](/a.md)\n";
  assert.deepEqual(await run({ "llms.txt": text, "a.md": "# A\n" }), []);
});

test("readability.llms-txt reports empty, HTML, a missing H1, bad entries, and dead links", async () => {
  assert.match((await run({ "llms.txt": "  \n" }))[0]!.message, /empty/);
  assert.match((await run({ "llms.txt": "<!doctype html><title>404</title>" }))[0]!.message, /HTML page/);
  const noH1 = await run({ "llms.txt": "> only a summary\n\n## Docs\n" });
  assert.deepEqual(noH1.map((f) => [f.location.line, f.severity]), [[1, "warning"]]);
  const entries = await run({ "llms.txt": "# S\n\n## Docs\n\n- plain text\n- [Gone](/gone.md)\n- [Here](/a.md)\n", "a.md": "x" });
  assert.deepEqual(entries.map((f) => f.location.line), [5, 6]);
  assert.match(entries[1]!.message, /\/gone\.md/);
});

test("readability.llms-txt checks llms-full.txt and ignores a byte-order mark", async () => {
  assert.deepEqual(await run({ "llms.txt": "﻿# S\n", "llms-full.txt": "# S\n\nAll the text.\n" }), []);
  const findings = await run({ "llms.txt": "# S\n", "llms-full.txt": "" });
  assert.deepEqual(findings.map((f) => f.location.file), ["llms-full.txt"]);
});

test("readability.llms-txt honors the base path when resolving links", async () => {
  const site = buildSite(makeSite({ "index.html": PAGE, "llms.txt": "# S\n\n## D\n\n- [A](/repo/a.md)\n", "a.md": "x" }), { basePath: "/repo/" });
  const result = await runChecks({ site, checks: [readabilityLlmsTxt] });
  assert.deepEqual(result.findings, []);
});
