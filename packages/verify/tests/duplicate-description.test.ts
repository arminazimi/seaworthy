import assert from "node:assert/strict";
import { test } from "node:test";

import { metaDuplicateDescription } from "../src/checks/meta.js";
import { runChecks } from "../src/engine.js";
import { buildSite } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (description: string) =>
  `<!doctype html>\n<html lang="en">\n<head>\n  ${description}\n</head>\n<body><h1>t</h1></body>\n</html>\n`;
const DESC = (text: string) => `<meta name="description" content="${text}">`;
const STUB = (url: string) => `<!doctype html>\n<html lang="en">\n<head>\n  <meta http-equiv="refresh" content="0; url=${url}">\n  ${DESC("no redirect stub is checked")}\n</head>\n<body></body>\n</html>\n`;

async function findings(files: Record<string, string>) {
  const result = await runChecks({ site: buildSite(makeSite(files)), checks: [metaDuplicateDescription] });
  assert.deepEqual(result.errors, []);
  return result.findings;
}

test("meta.duplicate-description groups pages that share one description", async () => {
  const [finding] = await findings({
    "about.html": PAGE(DESC("The same sentence.")),
    "docs/guide.html": PAGE(DESC("The same sentence.")),
    "index.html": PAGE(DESC("A different page.")),
  });
  assert.ok(finding);
  assert.deepEqual([finding.checkId, finding.severity, finding.location.file, finding.location.line], ["meta.duplicate-description", "warning", "about.html", 4]);
  assert.match(finding.message, /^The meta description "The same sentence\." is the same on 2 pages: \/about\.html and \/docs\/guide\.html\./);
  assert.equal(finding.fix.kind, "manual");
  assert.equal(finding.fix.edits.length, 0);
});

test("meta.duplicate-description skips singletons, empty and missing descriptions, and redirect stubs", async () => {
  const files = {
    "index.html": PAGE(""),
    "single.html": PAGE(DESC("Only page with this text.")),
    "empty.html": `${PAGE(DESC("   "))}<p>t</p>`,
    "stub.html": STUB("/index.html"),
  };
  assert.deepEqual(await findings(files), []);
});

test("meta.duplicate-description groups descriptions that differ only in whitespace", async () => {
  const files = {
    "a.html": PAGE(DESC("The  same  sentence.")),
    "b.html": PAGE(DESC("The\nsame\tsentence.")),
  };
  const [finding] = await findings(files);
  assert.ok(finding);
  assert.deepEqual(finding.location.file, "a.html");
  assert.match(finding.message, /^The meta description "The same sentence\." is the same on 2 pages/);
});

test("meta.duplicate-description names a few pages and counts the rest", async () => {
  const urls = ["a", "b", "c", "d", "e", "f", "g"].map((n) => `${n}.html`);
  const files = Object.fromEntries(urls.map((file) => [file, PAGE(DESC("One text for the whole site."))]));
  const [finding] = await findings(files);
  assert.ok(finding);
  assert.match(finding.message, / is the same on 7 pages: \/a\.html, \/b\.html, \/c\.html, \/d\.html, \/e\.html, and 2 more\./);
});

test("meta.duplicate-description groups each duplicated text separately and truncates a long quote", async () => {
  const files = {
    "a.html": PAGE(DESC("A".repeat(120))),
    "b.html": PAGE(DESC("A".repeat(120))),
    "c.html": PAGE(DESC("B page.")),
    "d.html": PAGE(DESC("B page.")),
  };
  const result = await findings(files);
  assert.deepEqual(result.map((f) => f.location.file), ["a.html", "c.html"]);
  assert.ok(result[0]!.message.startsWith(`The meta description "${"A".repeat(80)}…"`));
  assert.ok(result[1]!.message.startsWith('The meta description "B page."'));
});
