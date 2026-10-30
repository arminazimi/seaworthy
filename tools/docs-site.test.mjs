// The docs site generator (tools/docs-site.mjs) must produce output that passes Seaworthy's
// own agent-readability checks — the dogfood promise of issue #111. The verification runs the
// real engine over the real `docs/` tree; nothing here asserts against a hand-written claim.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { builtInChecks, verifySite } from "../packages/verify/dist/src/index.js";
import { SITE_NAME, buildDocsSite } from "./docs-site.mjs";

const docsDir = resolve(import.meta.dirname, "..", "docs");

const build = () => {
  const outDir = mkdtempSync(join(tmpdir(), "docs-site-"));
  buildDocsSite({ docsDir, outDir });
  return outDir;
};

const htmlPages = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.toString().endsWith(".html")).map((f) => join(dir, f.toString()));

test("the built docs site passes readability.llms-txt and readability.md-alternates with no findings", async () => {
  const site = build();
  const checks = builtInChecks.filter((c) => c.meta.id === "readability.llms-txt" || c.meta.id === "readability.md-alternates");
  assert.equal(checks.length, 2, "both checks must still exist to run the dogfood");
  const { report } = await verifySite({ folder: site, rootLabel: "_site", checks, now: new Date("2027-01-01T00:00:00Z") });
  assert.deepEqual(
    report.findings.map((f) => `${f.checkId} @ ${f.location.file}:${f.location.line ?? ""}: ${f.message}`),
    [],
    "the docs site must pass its own llms.txt and Markdown-alternate checks"
  );
});

test("every built docs page links its Markdown twin, verbatim, and is listed in llms.txt", () => {
  const site = build();
  const llms = readFileSync(join(site, "llms.txt"), "utf8");
  assert.ok(llms.startsWith(`# ${SITE_NAME}\n`), "llms.txt starts with the H1 the proposal requires");
  const pages = htmlPages(join(site, "docs"));
  assert.ok(pages.length > 50, `expected the whole docs tree built, got ${pages.length} pages`);
  for (const page of pages) {
    const twin = /<link rel="alternate" type="text\/markdown" href="([^"]+)">/u.exec(readFileSync(page, "utf8"));
    assert.ok(twin, `${page} has no Markdown alternate link`);
    const twinFile = join(site, twin[1].slice(1));
    assert.ok(existsSync(twinFile), `${page} points at ${twin[1]}, which the build did not write`);
    assert.ok(llms.includes(`](${twin[1]})`), `${twin[1]} is an alternate but is not listed in llms.txt`);
    const source = readFileSync(join(docsDir, twin[1].slice("/docs/".length).replace(/\.md$/u, ".md")), "utf8");
    const twinText = readFileSync(twinFile, "utf8");
    assert.equal(twinText, source.endsWith("\n") ? source : `${source}\n`, `${twin[1]} is not the verbatim source`);
  }
  assert.ok(readFileSync(join(site, "llms-full.txt"), "utf8").startsWith(`# ${SITE_NAME}\n`), "llms-full.txt is Markdown with an H1 too");
});

test("the build is deterministic: two builds write identical trees", () => {
  const a = build();
  const b = build();
  const tree = (dir) =>
    readdirSync(dir, { recursive: true })
      .map((f) => f.toString())
      .filter((f) => statSync(join(dir, f)).isFile())
      .sort()
      .map((f) => `${f}\u0000${readFileSync(join(dir, f), "utf8")}`);
  assert.deepEqual(tree(b), tree(a));
});
