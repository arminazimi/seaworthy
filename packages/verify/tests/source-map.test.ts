// Source locations (#197): the reader of spec/source-map/v0.md, and the pipeline that puts what it
// finds on a finding. The load-bearing rules are the contract's failure table — every bad or absent
// mapping degrades to "no source location", never to a crash, a failed run, or a path this module
// made up — and that a site without a published map produces exactly the report bytes it produced
// before. All of it is offline: one file in the built folder, and the Markdown the user points at.

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { ndjsonLine } from "../src/formats/ndjson.js";
import { anchorOf, readSourceMapText, sourceResolver } from "../src/source-map.js";
import { buildSite } from "../src/site.js";
import { type VerifyOptions, verifySite } from "../src/verify.js";
import type { Check, Finding, FindingDraft } from "../src/types.js";
import { makeSite, reportErrors } from "./helpers.js";

/** One finding per page's `<img>`, with that line of markup as its snippet: a whole-page finding. */
const imgCheck: Check = {
  meta: { id: "images.alt", title: "Image has no alt", severity: "error", needs: ["html"], docs: "https://example.test", standards: [] },
  run: (ctx): Iterable<FindingDraft> =>
    [...ctx.site.pages.values()].flatMap((page) =>
      page.elements
        .filter((element) => element.tagName === "img")
        .map((element) => ({
          message: "no alt",
          location: {
            file: page.file,
            line: element.sourceCodeLocation!.startLine,
            snippet: page.source.split(/\r?\n/)[element.sourceCodeLocation!.startLine - 1]!.trim(),
          },
          fix: { kind: "manual" as const, summary: "add alt" },
          key: element.attrs.find((a) => a.name === "src")?.value ?? "",
        })),
    ),
};

/** One finding per section, located by its bare id selector: the finding an anchor answers. */
const sectionCheck: Check = {
  meta: { id: "headings.h1", title: "Heading is not descriptive", severity: "warning", needs: ["html"], docs: "https://example.test", standards: [] },
  run: (ctx): Iterable<FindingDraft> =>
    [...ctx.site.pages.values()].flatMap((page) =>
      page.elements
        .filter((element) => element.tagName === "h2")
        .map((element) => {
          const id = element.attrs.find((a) => a.name === "id")?.value;
          return {
            message: "section heading",
            location: { file: page.file, ...(id === undefined ? {} : { selector: `#${id}` }) },
            fix: { kind: "manual" as const, summary: "word the heading for a person" },
            key: page.file,
          };
        }),
    ),
};

/** `docs/guide/index.html` and `index.html`, with a section carrying the id `installation`. */
const PAGE = (id?: string) => `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n<main><h2${id === undefined ? "" : ` id="${id}"`}>Installation</h2><img src="/a.png"></main>\n</body></html>\n`;

/** The published map, exactly in the shape the spec's worked example uses. */
const MAP = JSON.stringify({
  spec: 0,
  entries: [
    { target: "docs/guide/index.html", source: "src/content/docs/guide.md", line: 1 },
    { target: "docs/guide/index.html", anchor: "installation", source: "src/content/docs/guide.md", line: 10, column: 1 },
    { target: "index.html", source: "src/pages/index.astro", line: 3 },
  ],
});

/** A Markdown source declaring its own published path; its `## Installation` heading is on line 10. */
const GUIDE_MD = "---\ntitle: Guide\npermalink: /docs/guide/\n---\n\n# Guide\n\nText.\n\n## Installation\n\nSteps.\n";

/** A repository root: whatever a map's `source` paths may legitimately point at. */
const repo = (files: Record<string, string> = {}): string => makeSite({ "src/content/docs/guide.md": GUIDE_MD, "src/pages/index.astro": "---\n---\n<h1>Hi</h1>\n", ...files });

/** A resolver over a built site plus the repository root its sources live in. */
function resolver(siteFiles: Record<string, string>, map: string | undefined, options: { repoRoot?: string; markdownSources?: VerifyOptions["markdownSources"] } = {}): ReturnType<typeof sourceResolver> {
  const site = buildSite(makeSite(map === undefined ? siteFiles : { ...siteFiles, "source-map.json": map }));
  return sourceResolver({ site, repoRoot: options.repoRoot ?? repo(), ...(options.markdownSources === undefined ? {} : { markdownSources: options.markdownSources }) });
}

/** A resolver whose sources are Markdown files in one folder, the way `--markdown` hands them over. */
function markdownResolver(markdownText: string): { site: ReturnType<typeof buildSite>; resolver: ReturnType<typeof sourceResolver> } {
  const root = repo({ "docs/guide.md": markdownText });
  const site = buildSite(makeSite({ "docs/guide/index.html": PAGE("installation"), "index.html": PAGE() }));
  return { site, resolver: sourceResolver({ site, repoRoot: root, markdownSources: { root, files: [join(root, "docs", "guide.md")] } }) };
}

// --- the contract, read as written -------------------------------------------------------------

test("a conforming file yields its entries, and unknown members are ignored", () => {
  const reading = readSourceMapText(JSON.stringify({ spec: 0, generatedBy: "some-theme", entries: [{ target: "a.html", source: "src/a.md", line: 2, column: 4, kind: "page" }] }));
  assert.equal(reading.ignored, false);
  assert.deepEqual(reading.entries, [{ target: "a.html", source: "src/a.md", line: 2, column: 4 }]);
  assert.deepEqual(reading.refused, []);
});

test("a file that is not JSON, not an object, or not shaped like the contract is ignored whole", () => {
  for (const text of ["not json at all", "[]", "null", '"a string"', '{"spec":0}', '{"entries":[]}', '{"spec":"0","entries":[]}', '{"spec":0,"entries":{}}']) {
    assert.deepEqual(readSourceMapText(text), { entries: [], refused: [], ignored: true }, `${text} must be ignored, not half-read`);
  }
});

test("an unreadable entry is skipped by name and its neighbours survive", () => {
  const reading = readSourceMapText(JSON.stringify({ spec: 0, entries: [{ target: "ok.html", source: "src/ok.md", line: 1 }, { target: "bad.html", source: "src/bad.md" }, { target: "line.html", source: "src/line.md", line: 0 }, "nope"] }));
  assert.deepEqual(reading.entries, [{ target: "ok.html", source: "src/ok.md", line: 1 }]);
  assert.deepEqual(reading.refused, ["bad.html", "line.html", "entry 3"]);
});

test("the security rule: a path that leaves its root is refused, entry by entry", () => {
  for (const source of ["../../secret.md", "/etc/passwd", "C:/Windows/x.md", "a\\b.md", "src/../../a.md"]) {
    const reading = readSourceMapText(JSON.stringify({ spec: 0, entries: [{ target: "a.html", source, line: 1 }] }));
    assert.deepEqual(reading.entries, [], `${source} escapes the repository root and must be refused`);
    assert.deepEqual(reading.refused, ["a.html"]);
  }
  for (const target of ["/a.html", "../a.html", "a\\b.html"]) {
    assert.deepEqual(readSourceMapText(JSON.stringify({ spec: 0, entries: [{ target, source: "src/a.md", line: 1 }] })).entries, [], `${target} is not a site-relative path`);
  }
});

test("a `spec` newer than this reader is read for what it knows, never rejected", () => {
  const reading = readSourceMapText(JSON.stringify({ spec: 7, entries: [{ target: "a.html", source: "src/a.md", line: 1, nextField: "whatever" }] }));
  assert.equal(reading.ignored, false);
  assert.deepEqual(reading.entries, [{ target: "a.html", source: "src/a.md", line: 1 }]);
});

// --- the resolver: map first, then what the generator declares, then nothing -------------------

test("no map at the site root is normal: nothing is located and nothing is refused", () => {
  const found = resolver({ "index.html": PAGE() }, undefined);
  assert.equal(found.locate("index.html"), undefined);
  assert.deepEqual(found.refused, []);
});

test("the section entry answers an anchor, and the whole-file entry answers the page and every anchor the map leaves out", () => {
  const found = resolver({ "index.html": PAGE(), "docs/guide/index.html": PAGE("installation") }, MAP);
  assert.deepEqual(found.locate("docs/guide/index.html", "installation"), { file: "src/content/docs/guide.md", line: 10, column: 1 });
  assert.deepEqual(found.locate("docs/guide/index.html"), { file: "src/content/docs/guide.md", line: 1 });
  assert.deepEqual(found.locate("docs/guide/index.html", "not-in-the-map"), { file: "src/content/docs/guide.md", line: 1 }, "the contract says an unmatched anchor falls back to the whole-file entry");
  assert.deepEqual(found.locate("index.html"), { file: "src/pages/index.astro", line: 3 });
  assert.equal(found.locate("secrets/index.html"), undefined, "a page the map does not mention keeps its built-output location");
});

test("an entry whose target is not built, or whose source is gone, is refused by name", () => {
  const missingTarget = resolver({ "index.html": PAGE() }, JSON.stringify({ spec: 0, entries: [{ target: "ghost.html", source: "src/content/docs/guide.md", line: 1 }] }));
  assert.equal(missingTarget.locate("ghost.html"), undefined);
  assert.deepEqual(missingTarget.refused, ["ghost.html (not in the built output)"]);

  const staleSource = resolver({ "docs/guide/index.html": PAGE() }, JSON.stringify({ spec: 0, entries: [{ target: "docs/guide/index.html", source: "src/content/docs/deleted.md", line: 1 }] }), { repoRoot: repo({ "src/content/docs/guide.md": GUIDE_MD }) });
  assert.equal(staleSource.locate("docs/guide/index.html"), undefined);
  assert.deepEqual(staleSource.refused, ["docs/guide/index.html (source src/content/docs/deleted.md is not there)"]);
});

test("a malformed map file never crashes a lookup and never locates anything", () => {
  const found = resolver({ "index.html": PAGE() }, '{ "spec": 0, "entries": [ { "target": ');
  assert.equal(found.locate("index.html"), undefined);
  assert.deepEqual(found.refused, []);
});

test("the first whole-file entry per target wins, so a broken map still reads deterministically", () => {
  const found = resolver(
    { "index.html": PAGE() },
    JSON.stringify({ spec: 0, entries: [{ target: "index.html", source: "src/pages/index.astro", line: 3 }, { target: "index.html", source: "src/pages/index.astro", line: 9 }] }),
  );
  assert.deepEqual(found.locate("index.html"), { file: "src/pages/index.astro", line: 3 });
});

test("with no map, a source that declares its permalink says which page it built", () => {
  const { resolver: found } = markdownResolver(GUIDE_MD);
  assert.deepEqual(found.locate("docs/guide/index.html"), { file: "docs/guide.md" }, "the file is declared; the line is not, so none is invented");
  assert.deepEqual(found.locate("docs/guide/index.html", "installation"), { file: "docs/guide.md", line: 10 }, "the anchor is the heading that slugs to it, at the line the Markdown says");
  assert.equal(found.locate("index.html"), undefined, "a page nobody declares is left at its built output");
});

test("a permalink still holding a generator placeholder names no page", () => {
  const { resolver: found } = markdownResolver("---\npermalink: /:title/\n---\n\n# Guide\n");
  assert.equal(found.locate("docs/guide/index.html"), undefined);
});

test("a permalink that is relative, empty, nested, or names no built page declares nothing", () => {
  for (const text of ["---\npermalink: docs/guide/\n---\n\n# Guide\n", "---\npermalink:\n---\n\n# Guide\n", "---\nmenu:\n  permalink: /docs/guide/\n---\n\n# Guide\n", "---\npermalink: /nowhere/\n---\n\n# Guide\n", "no front matter here\n## Installation\n"]) {
    const { resolver: found } = markdownResolver(text);
    assert.equal(found.locate("docs/guide/index.html"), undefined, `${text.split("\n")[1] ?? text} is not a published path this reader may assume`);
  }
});

test("a quoted permalink and one with padding are the path they spell", () => {
  const { resolver: found } = markdownResolver('---\npermalink:  "/docs/guide/"  \n---\n\n# Guide\n');
  assert.deepEqual(found.locate("docs/guide/index.html"), { file: "docs/guide.md" });
});

test("the published map answers for a page it covers, and the declaration fills the rest", () => {
  const root = repo({ "docs/guide.md": GUIDE_MD });
  const found = resolver(
    { "docs/guide/index.html": PAGE("installation"), "about/index.html": PAGE(), "source-map.json": JSON.stringify({ spec: 0, entries: [{ target: "about/index.html", source: "src/pages/about.astro", line: 2 }] }) },
    undefined,
    { repoRoot: repo({ "src/pages/about.astro": "---\n---\n<h1>About</h1>\n" }), markdownSources: { root, files: [join(root, "docs", "guide.md")] } },
  );
  assert.deepEqual(found.locate("about/index.html"), { file: "src/pages/about.astro", line: 2 });
  assert.deepEqual(found.locate("docs/guide/index.html"), { file: "docs/guide.md" }, "the declaration covers what the map leaves out");
});

// --- which section a finding is about ----------------------------------------------------------

const findingAt = (location: Partial<Finding["location"]>): Finding => ({
  checkId: "images.alt",
  severity: "error",
  message: "no alt",
  location: { file: "docs/guide/index.html", ...location },
  fix: { kind: "manual", summary: "add alt", edits: [], appliesTo: "built-output" },
  fingerprint: "0123456789abcdef",
});

test("an anchor comes from the finding's own locator: a bare id selector or an id on its own tag", () => {
  assert.equal(anchorOf(findingAt({ selector: "#installation" })), "installation");
  assert.equal(anchorOf(findingAt({ snippet: '<h2 id="installation">Installation</h2>' })), "installation");
  assert.equal(anchorOf(findingAt({ snippet: "<img src='/a.png' id='badge' width='20'>" })), "badge");
  assert.equal(anchorOf(findingAt({ snippet: '<p id = "installation" >x</p>' })), "installation");
  assert.equal(anchorOf(findingAt({ snippet: "<img src=\"/a.png\">" })), undefined, "no id, no section");
  assert.equal(anchorOf(findingAt({ selector: "main > p:nth-child(2)" })), undefined, "a path selector names no fragment");
  assert.equal(anchorOf(findingAt({ snippet: "<p>See <a id=\"installation\">here</a></p>" })), undefined, "the id of a nested tag is not this finding's anchor");
  assert.equal(anchorOf(findingAt({ snippet: '<a title="set id=nope">x</a>' })), undefined, "an id inside an attribute value is not an id attribute");
});

// --- the pipeline -------------------------------------------------------------------------------

async function run(siteFiles: Record<string, string>, extra: Partial<VerifyOptions> = {}) {
  return verifySite({
    folder: makeSite(siteFiles),
    rootLabel: "dist",
    checks: [imgCheck, sectionCheck],
    now: new Date("2027-02-01T00:00:00Z"),
    repoRoot: repo(),
    ...extra,
  });
}

/** The finding about the `<img>`: a whole-page finding, its snippet naming no section. */
const imageFinding = (findings: readonly Finding[]): Finding => findings.find((f) => f.checkId === "images.alt")!;
/** The finding about the section heading: located by its bare `#installation` selector. */
const sectionFinding = (findings: readonly Finding[]): Finding => findings.find((f) => f.checkId === "headings.h1")!;

test("a mapped finding carries its source, validates against the report schema, and says so in its prompt", async () => {
  const { report } = await run({ "docs/guide/index.html": PAGE("installation"), "source-map.json": MAP });
  const image = imageFinding(report.findings);
  assert.deepEqual(image.sourceLocation, { file: "src/content/docs/guide.md", line: 1 });
  assert.deepEqual(sectionFinding(report.findings).sourceLocation, { file: "src/content/docs/guide.md", line: 10, column: 1 });
  assert.deepEqual(reportErrors(report), []);
  assert.match(image.prompt!, /its source is src\/content\/docs\/guide\.md:1, so edit that file/);
  assert.doesNotMatch(image.prompt!, /apply the same fix in the source that generates it/);
  assert.ok(ndjsonLine(image).includes('"sourceLocation"'), "the streamed line carries the finding as the report does");
});

test("a site with no map reports exactly what it reported before: no field, no prompt change", async () => {
  const plain = await run({ "docs/guide/index.html": PAGE("installation") });
  const broken = await run({ "docs/guide/index.html": PAGE("installation"), "source-map.json": "{ not json" });
  assert.equal(imageFinding(plain.report.findings).sourceLocation, undefined);
  assert.match(imageFinding(plain.report.findings).prompt!, /apply the same fix in the source that generates it/);
  assert.equal(JSON.stringify(plain.report), JSON.stringify(broken.report), "an unreadable map is invisible, not a different report");
});

test("the generator's own declaration reaches the report when the user points at the sources", async () => {
  const root = repo({ "docs/guide.md": GUIDE_MD });
  const { report } = await run({ "docs/guide/index.html": PAGE("installation") }, { markdownSources: { root, files: [join(root, "docs", "guide.md")] }, repoRoot: root });
  assert.deepEqual(sectionFinding(report.findings).sourceLocation, { file: "docs/guide.md", line: 10 });
  assert.match(sectionFinding(report.findings).prompt!, /its source is docs\/guide\.md:10, so edit that file/);
});

test("findings the map does not cover keep their built-output location, next to ones it does", async () => {
  const { report } = await run({ "index.html": PAGE(), "docs/guide/index.html": PAGE("installation"), "source-map.json": MAP });
  const sources = new Map(report.findings.map((f) => [`${f.location.file}/${f.checkId}`, f.sourceLocation]));
  assert.deepEqual(sources.get("index.html/images.alt"), { file: "src/pages/index.astro", line: 3 });
  assert.deepEqual(sources.get("docs/guide/index.html/headings.h1"), { file: "src/content/docs/guide.md", line: 10, column: 1 });

  const unmapped = await run({ "blog/post/index.html": PAGE(), "source-map.json": MAP });
  assert.deepEqual(
    unmapped.report.findings.map((f) => f.sourceLocation),
    [undefined, undefined],
  );
});

test("the whole-report prompts name the source too", async () => {
  const { report } = await run({ "index.html": PAGE(), "source-map.json": MAP });
  assert.match(report.prompt!, /Source is src\/pages\/index\.astro:3\./);
});
