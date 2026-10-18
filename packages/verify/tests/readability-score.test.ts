import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { builtInChecks } from "../src/checks/index.js";
import { formatMarkdown } from "../src/formats/markdown.js";
import { formatPretty } from "../src/formats/pretty.js";
import { readabilitySummary } from "../src/readability-score.js";
import { buildSite } from "../src/site.js";
import { verifySite } from "../src/verify.js";
import { makeSite, reportErrors } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PAGE = '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>Title</h1><p>Seaworthy checks built sites before they are deployed so agents can trust them.</p></main></body></html>';
const readability = builtInChecks.filter((c) => c.meta.id.startsWith("readability."));
const NOW = new Date("2027-01-01T00:00:00Z");

async function summary(files: Record<string, string>) {
  const { report } = await verifySite({ site: buildSite(makeSite({ "index.html": PAGE, ...files })), folder: ".", rootLabel: "site", checks: readability, now: NOW });
  assert.deepEqual(reportErrors(report), []);
  return report.summary.readability;
}

test("a site with nothing optional is scored on what applies: llms.txt (missing, a note) and content", async () => {
  assert.deepEqual(await summary({}), { score: 50, checks: 2, passed: 1, withFindings: 1 });
});

test("a site that publishes valid files is clean, and files it does not publish do not count", async () => {
  const files = { "llms.txt": "# Site\n\n> Summary.\n", "robots.txt": "User-agent: *\nContent-Signal: search=yes, ai-train=no\n" };
  assert.deepEqual(await summary(files), { score: 100, checks: 4, passed: 4, withFindings: 0 });
});

test("a broken optional file lowers the score, and only because it exists", async () => {
  const files = { "llms.txt": "# Site\n", ".well-known/agent-card.json": "{" };
  assert.deepEqual(await summary(files), { score: 67, checks: 3, passed: 2, withFindings: 1 });
});

test("reports without any readability check carry no summary, and skipped checks are not counted", async () => {
  const { report } = await verifySite({ site: buildSite(makeSite({ "index.html": PAGE })), folder: ".", rootLabel: "site", checks: builtInChecks.filter((c) => c.meta.id === "meta.title"), now: NOW });
  assert.equal(report.summary.readability, undefined);
  const site = buildSite(makeSite({ "index.html": PAGE }));
  assert.equal(readabilitySummary(site, ["readability.markdown-negotiation"], []) !== undefined, true, "it counts only when it ran");
  assert.equal(readabilitySummary(site, ["meta.title"], []), undefined);
});

test("the clean fixture scores 100, and the line appears in the terminal and Markdown reports", async () => {
  const { report } = await verifySite({ folder: join(ROOT, "fixtures", "clean", "minimal", "site"), rootLabel: "site", checks: builtInChecks, now: NOW });
  assert.deepEqual(report.summary.readability, { score: 100, checks: 3, passed: 3, withFindings: 0 });
  assert.match(formatPretty(report), /Agent readability: 100\/100 \(3 of 3 applicable checks clean\)\./);
  assert.match(formatMarkdown(report), /Agent readability: 100\/100/);
});
