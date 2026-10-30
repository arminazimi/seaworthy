// md.links: links between Markdown files that point at missing files, located at the source line.

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { mdLinks } from "../src/checks/md-links.js";
import { markdownOf } from "../src/checks/markdown-graph.js";
import { buildSite } from "../src/site.js";
import type { Check, Finding } from "../src/types.js";
import { runChecks } from "../src/engine.js";
import { makeSite } from "./helpers.js";

async function findings(check: Check, files: Record<string, string>): Promise<Finding[]> {
  const site = buildSite(makeSite(files));
  const result = await runChecks({ site, checks: [check] });
  assert.deepEqual(result.errors, [], "no check may crash");
  return result.findings;
}

test("md.links reports an internal link whose target is missing, at the Markdown line", async () => {
  const [f] = await findings(mdLinks, {
    "README.md": "# Home\n\nSee [the draft](notes/draft.md) for details.\n",
  });
  assert.equal(f!.checkId, "md.links");
  assert.equal(f!.severity, "error");
  assert.equal(f!.message, "Link to notes/draft.md points to a file that does not exist in the Markdown sources.");
  assert.deepEqual(f!.location, { file: "README.md", line: 3 });
  assert.equal(f!.fix.kind, "manual");
  assert.match(f!.fix.summary, /Create notes\/draft\.md, or point the link/);
  assert.deepEqual(f!.fix.edits, []);
});

test("md.links offers an exact edit when one file in the graph has the missing basename", async () => {
  const [f] = await findings(mdLinks, {
    "docs/guide.md": "# Guide\n",
    "notes.md": "Old folder: [x](../doc/guide.md)\n",
  });
  assert.equal(f!.fix.kind, "edit");
  assert.deepEqual(f!.fix.edits, [{ file: "notes.md", line: 1, action: "replace", find: "../doc/guide.md", replace: "docs/guide.md" }]);
  assert.match(f!.fix.summary, /Point the link at docs\/guide\.md/);
});

test("the basename repair keeps a fragment and the style (relative or root-absolute) of the link", async () => {
  const out = await findings(mdLinks, {
    "docs/guide.md": "# Guide\n\n## Setup\n",
    "notes.md": "[a](/doc/guide.md#setup)\n[b](doc/guide.md#setup)\n",
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((f) => [f.location.line, f.fix.kind, f.fix.edits[0]?.replace]), [
    [1, "edit", "/docs/guide.md#setup"],
    [2, "edit", "docs/guide.md#setup"],
  ]);
});

test("basename matching ignores case, and several matches mean no guess", async () => {
  const [one] = await findings(mdLinks, { "docs/Guide.md": "# G\n", "notes.md": "[x](doc/guide.md)\n" });
  assert.equal(one!.fix.kind, "edit");
  assert.equal(one!.fix.edits[0]!.replace, "docs/Guide.md");
  const [two] = await findings(mdLinks, { "docs/guide.md": "# G\n", "blog/guide.md": "# G\n", "notes.md": "[x](doc/guide.md)\n" });
  assert.equal(two!.fix.kind, "manual", "two files share the basename: never guess between them");
  assert.deepEqual(two!.fix.edits, []);
});

test("the edit is declined when the anchor is not unique on the line", async () => {
  const [f] = await findings(mdLinks, { "docs/guide.md": "# G\n", "notes.md": "[a](doc/guide.md) then [b](doc/guide.md)\n" });
  assert.equal(f!.fix.kind, "manual");
  assert.deepEqual(f!.fix.edits, []);
});

test("md.links skips external, ignored, fragment-only, and resolvable links", async () => {
  const out = await findings(mdLinks, {
    "docs/guide.md": "# Guide\n\n## Setup\n",
    "notes.md": [
      "# Notes",
      "",
      "[good](docs/guide.md) [section](docs/guide.md#setup) [self](#notes) [empty]() [site](https://example.com/a) [mail](mailto:a@b.test) [tel](tel:1) [protocol-relative](//example.com).",
      "",
      "```",
      "[fenced](missing.md)",
      "```",
    ].join("\n"),
    "index.html": "<p>not markdown</p>",
  });
  assert.deepEqual(out, []);
});

test("reference-style links resolve through their definition, once", async () => {
  const out = await findings(mdLinks, { "notes.md": "See [the guide][g].\n\n[g]: nowhere/guide.md\n" });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.location.line, 1);
});

test("findings are deterministic: files by path, links in document order", async () => {
  const out = await findings(mdLinks, {
    "b.md": "[one](gone1.md) line\n\n[two](gone2.md) line\n",
    "a.md": "[zero](gone0.md) line\n",
  });
  assert.deepEqual(out.map((f) => [f.location.file, f.location.line]), [["a.md", 1], ["b.md", 1], ["b.md", 3]]);
});

test("a site with no Markdown files reports nothing and does not crash", async () => {
  const out = await findings(mdLinks, { "index.html": "<!doctype html>\n<html lang=\"en\"><body><a href=\"nowhere.md\">x</a></body></html>\n" });
  assert.deepEqual(out, []);
});

test("markdownOf is undefined without Markdown files and cached per site graph", () => {
  const htmlOnly = buildSite(makeSite({ "index.html": "<p>x</p>" }));
  assert.equal(markdownOf(htmlOnly), undefined);
  assert.equal(markdownOf(htmlOnly), undefined, "the empty decision is cached too");
  const site = buildSite(makeSite({ "a.md": "# A\n" }));
  const first = markdownOf(site);
  assert.ok(first !== undefined);
  assert.equal(markdownOf(site), first, "the same graph object is returned for the same run");
  assert.deepEqual([...first.files.keys()], ["/a.md"]);
});

test("markdownOf builds the graph over explicit --markdown sources and caches per source list", () => {
  const site = buildSite(makeSite({ "index.md": "# Site\n", "inside.md": "[x](missing.md)\n" }));
  const docsDir = makeSite({ "README.md": "[y](outside.md)\n" });
  const sources = { root: docsDir, files: [join(docsDir, "README.md")] };
  const graph = markdownOf(site, sources);
  assert.ok(graph !== undefined);
  assert.deepEqual([...graph.files.keys()], ["/README.md"], "the named files replace the site walk");
  assert.equal(markdownOf(site, sources), graph, "the same source list is cached");
  assert.deepEqual([...markdownOf(site)!.files.keys()], ["/index.md", "/inside.md"], "the plain site walk is untouched");
});
