// md.anchors: heading anchors that no heading in the linked Markdown file has, located at the source line.

import assert from "node:assert/strict";
import { test } from "node:test";

import { mdAnchors } from "../src/checks/md-anchors.js";
import { mdLinks } from "../src/checks/md-links.js";
import { buildSite } from "../src/site.js";
import { runChecks } from "../src/engine.js";
import type { Check, Finding } from "../src/types.js";
import { makeSite } from "./helpers.js";

async function findings(check: Check, files: Record<string, string>): Promise<Finding[]> {
  const site = buildSite(makeSite(files));
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, [], "no check may crash");
  return result.findings;
}

const GUIDE = "# Guide\n\n## Install\n\nRun it.\n\n## Usage\n\nFirst.\n\n## Usage\n\nSecond.\n";

test("md.anchors reports a dead anchor in another file, at the Markdown line and without a column", async () => {
  const [f] = await findings(mdAnchors, {
    "docs/guide.md": GUIDE,
    "notes.md": "Jump to [the start](docs/guide.md#start-here).\n",
  });
  assert.equal(f!.checkId, "md.anchors");
  assert.equal(f!.severity, "error");
  assert.equal(f!.message, "Link to docs/guide.md#start-here points at an anchor that no heading in docs/guide.md has. Its heading anchors are: guide, install, usage.");
  assert.deepEqual(f!.location, { file: "notes.md", line: 1 });
  assert.equal(f!.fix.kind, "manual");
  assert.match(f!.fix.summary, /Write a heading in docs\/guide\.md whose anchor is #start-here/);
  assert.deepEqual(f!.fix.edits, []);
});

test("md.anchors reports a dead anchor inside the file itself, naming the closest anchor", async () => {
  const [f] = await findings(mdAnchors, { "notes.md": "# Notes\n\n[back to the top](#note).\n" });
  assert.equal(f!.message, "Link to #note points at an anchor that no heading in notes.md has. Closest anchors in notes.md: notes.");
  assert.equal(f!.fix.kind, "manual");
});

test("a target file with no headings says so instead of listing anchors", async () => {
  const [f] = await findings(mdAnchors, { "plain.md": "Just a paragraph.\n", "notes.md": "[somewhere](plain.md#top)\n" });
  assert.match(f!.message, /no heading in plain\.md has\. plain\.md has no headings at all\./);
});

test("live anchors report nothing: exact, another case, percent-decoded, an empty fragment, the file itself, and no fragment", async () => {
  const out = await findings(mdAnchors, {
    "docs/guide.md": GUIDE,
    "notes.md": "# Notes\n\n[a](docs/guide.md#install) [b](docs/guide.md#INSTALL) [c](docs/guide.md#usage-1) [d](docs/guide.md#%69nstall) [e](docs/guide.md#) [f](#notes) [g](docs/guide.md)\n",
  });
  assert.deepEqual(out, []);
});

test("both copies of a repeated heading are live anchors", async () => {
  const out = await findings(mdAnchors, { "docs/guide.md": GUIDE, "notes.md": "[first](docs/guide.md#usage) [second](docs/guide.md#usage-1)\n" });
  assert.deepEqual(out, []);
});

test("a uniqueness suffix left over from a heading that is no longer repeated gets an exact edit", async () => {
  const [f] = await findings(mdAnchors, { "docs/guide.md": GUIDE, "notes.md": "[install steps](docs/guide.md#install-1)\n" });
  assert.equal(f!.fix.kind, "edit");
  assert.deepEqual(f!.fix.edits, [{ file: "notes.md", line: 1, action: "replace", find: "docs/guide.md#install-1", replace: "docs/guide.md#install" }]);
  assert.match(f!.fix.summary, /Point the link at #install, the anchor in docs\/guide\.md that differs from #install-1 only by GitHub's heading-dedup suffix/);
});

test("the edit keeps the link's own style, relative or root-absolute", async () => {
  const out = await findings(mdAnchors, { "docs/guide.md": GUIDE, "notes.md": "[a](/docs/guide.md#install-1)\n[b](docs/guide.md#install-1)\n" });
  assert.deepEqual(out.map((f) => [f.location.line, f.fix.kind, f.fix.edits[0]?.replace]), [
    [1, "edit", "/docs/guide.md#install"],
    [2, "edit", "docs/guide.md#install"],
  ]);
});

test("two anchors sharing the base mean no guess, and both are named in the message", async () => {
  const [f] = await findings(mdAnchors, { "docs/guide.md": GUIDE, "notes.md": "[usage](docs/guide.md#usage-2)\n" });
  assert.equal(f!.fix.kind, "manual", "#usage-2 is close to both #usage and #usage-1: never guess between them");
  assert.deepEqual(f!.fix.edits, []);
  assert.match(f!.message, /Closest anchors in docs\/guide\.md: usage, usage-1\./);
});

test("an edit is declined when the link text is not unique on the line", async () => {
  const [f] = await findings(mdAnchors, { "docs/guide.md": GUIDE, "notes.md": "[a](docs/guide.md#install-1) then [b](docs/guide.md#install-1)\n" });
  assert.equal(f!.fix.kind, "manual");
  assert.deepEqual(f!.fix.edits, []);
});

test("an anchor that only another file has is named in the fix, without rewriting the link", async () => {
  const [f] = await findings(mdAnchors, { "docs/guide.md": GUIDE, "docs/contact.md": "# Contact\n", "notes.md": "[contact](docs/guide.md#contact)\n" });
  assert.match(f!.message, /no heading in docs\/guide\.md has/);
  assert.equal(f!.fix.kind, "manual");
  assert.match(f!.fix.summary, /point the link at docs\/contact\.md#contact, the only Markdown file in the graph with that anchor/);
});

test("several files with the anchor are counted instead of guessed between", async () => {
  const [f] = await findings(mdAnchors, { "a.md": "# Setup\n", "docs/b.md": "# Setup\n", "guide.md": "# Guide\n", "notes.md": "[setup](guide.md#setup)\n" });
  assert.equal(f!.fix.kind, "manual");
  assert.match(f!.fix.summary, /one of the 2 Markdown files that have it \(a\.md, docs\/b\.md\)/);
});

test("a link to a missing file is md.links' finding, never md.anchors': one dead link, one finding", async () => {
  const files = { "docs/guide.md": GUIDE, "notes.md": "[dead file](todo/draft.md#plan) [dead anchor](docs/guide.md#plan)\n" };
  const site = buildSite(makeSite(files));
  const both = await runChecks({ site, checks: [mdLinks, mdAnchors] });
  assert.deepEqual(both.errors, []);
  assert.deepEqual(both.findings.map((f) => [f.checkId, f.location.line]), [["md.links", 1], ["md.anchors", 1]]);
  assert.match(both.findings[0]!.message, /todo\/draft\.md/);
  assert.match(both.findings[1]!.message, /docs\/guide\.md#plan/);
  assert.deepEqual((await findings(mdAnchors, files)).map((f) => f.location.file), ["notes.md"]);
});

test("external, ignored, and out-of-graph targets are not anchor findings", async () => {
  const out = await findings(mdAnchors, {
    "docs/guide.md": GUIDE,
    "notes.md": "# Notes\n\n[ext](https://example.com/guide.md#install) [mail](mailto:a@b.test) [site root](/) [code line](src/app.ts#L10)\n",
  });
  assert.deepEqual(out, []);
});

test("reference-style links and links inside headings are anchors too", async () => {
  const out = await findings(mdAnchors, {
    "docs/guide.md": GUIDE,
    "notes.md": "# Notes\n\nSee [the guide][g].\n\n## Also broken [inline](docs/guide.md#nope)\n\n[g]: docs/guide.md#also-nope\n",
  });
  assert.deepEqual(out.map((f) => [f.location.line, f.message]), [
    [3, "Link to docs/guide.md#also-nope points at an anchor that no heading in docs/guide.md has. Its heading anchors are: guide, install, usage."],
    [5, "Link to docs/guide.md#nope points at an anchor that no heading in docs/guide.md has. Its heading anchors are: guide, install, usage."],
  ]);
});

test("findings are deterministic: files by path, links in document order", async () => {
  const out = await findings(mdAnchors, {
    "b.md": "[one](a.md#gone1)\n\n[two](a.md#gone2)\n",
    "a.md": "# A\n\n[zero](a.md#gone0)\n",
  });
  assert.deepEqual(out.map((f) => [f.location.file, f.location.line]), [["a.md", 3], ["b.md", 1], ["b.md", 3]]);
});

test("a site with no Markdown files reports nothing and does not crash", async () => {
  const out = await findings(mdAnchors, { "index.html": "<!doctype html>\n<html lang=\"en\"><body><a href=\"guide.md#setup\">x</a></body></html>\n" });
  assert.deepEqual(out, []);
});

test("no finding, fix, or edit ever carries the absolute root", async () => {
  const files = { "a.md": "# A\n\n## A\n", "b.md": "[x](a.md#zzz) [y](a.md#a-2)\n" };
  const root = makeSite(files);
  const result = await runChecks({ site: buildSite(root), checks: [mdAnchors] });
  assert.ok(result.findings.length > 0);
  for (const f of result.findings) {
    assert.ok(!f.message.includes(root), `message must not contain ${root}`);
    assert.ok(!f.fix.summary.includes(root), "the fix summary holds no absolute root");
    assert.ok(!f.location.file.startsWith("/"), "the location is site-relative");
    for (const edit of f.fix.edits) assert.ok(!edit.file.startsWith("/") && !edit.file.includes(root));
  }
});
