import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMarkdownGraph, createSlugger, headingText, parseMarkdown, resolveTarget } from "../src/markdown.js";
import { makeSite } from "./helpers.js";

test("parseMarkdown extracts ordered headings with exact slugs from ATX and setext lines", () => {
  const source = [
    "# Install",
    "",
    "## Quick start",
    "",
    "### `npm run check`",
    "",
    "   #### 404 Handling ####",
    "",
    "Setext top",
    "==========",
    "",
    "Setext sub",
    "---",
  ].join("\n");
  const parsed = parseMarkdown(source);
  assert.equal(parsed.headings.length, 6);
  assert.deepEqual(parsed.headings.map(({ level }) => level), [1, 2, 3, 4, 1, 2]);
  assert.deepEqual(
    parsed.headings.map(({ slug, line }) => ({ slug, line })),
    [
      { slug: "install", line: 1 },
      { slug: "quick-start", line: 3 },
      { slug: "npm-run-check", line: 5 },
      { slug: "404-handling", line: 7 },
      { slug: "setext-top", line: 9 },
      { slug: "setext-sub", line: 12 },
    ],
  );
});

test("heading slugs follow GitHub exactly for code spans, emojis, leading digits, and punctuation", () => {
  const slug = (text: string) => createSlugger().slug(headingText(text));
  assert.equal(slug("`a.b` `c`"), "ab-c");
  assert.equal(slug("🚀 Launching"), "-launching");
  assert.equal(slug("404 Page Not Found"), "404-page-not-found");
  assert.equal(slug("C++ (and) C#"), "c-and-c");
  assert.equal(slug("Foo & bar &amp; co"), "foo--bar--co");
  assert.equal(slug("**Bold** _slanted_ ~~gone~~"), "bold-slanted-gone");
  assert.equal(slug("snake_case stays"), "snake_case-stays");
  assert.equal(slug("café — naïve"), "café--naïve");
});

test("duplicate headings deduplicate with -1, -2 suffixes", () => {
  const slugger = createSlugger();
  assert.equal(slugger.slug(headingText("Collides")), "collides");
  assert.equal(slugger.slug(headingText("Collides")), "collides-1");
  assert.equal(slugger.slug(headingText("collides-1")), "collides-1-1");
  assert.equal(slugger.slug(headingText("collides-1")), "collides-1-2");
});

test("code spans inside headings contribute their text without backtick punctuation", () => {
  const parsed = parseMarkdown("### Use `verify --fix offline`\n");
  assert.equal(parsed.headings[0]!.text, "Use verify --fix offline");
  assert.equal(parsed.headings[0]!.slug, "use-verify---fix-offline");
});

test("emoji are removed from slugs, keeping surrounding spaces as dashes", () => {
  const parsed = parseMarkdown("## 🎉 Party time");
  assert.equal(parsed.headings[0]!.slug, "-party-time");
});

test("attx-like lines without a space after the hashes are not headings", () => {
  const parsed = parseMarkdown("###nothash\n#hash\n");
  assert.deepEqual(parsed.headings, []);
  assert.deepEqual(parsed.links, []);
});

test("fenced and indented code never yield headings or links", () => {
  const source = [
    "Intro line",
    "",
    "```",
    "# Not a heading",
    "[not a link](missing.md)",
    "```",
    "itudeso~~",
    "~~~",
    "# Also not a heading",
    "~~~",
    "",
    "    # not a heading either",
    "    [not a link](missing.md) and # skip",
    "",
    "Real [link](real.md)",
  ].join("\n");
  const parsed = parseMarkdown(source);
  assert.equal(parsed.headings.length, 0);
  assert.equal(parsed.links.length, 1);
  assert.equal(parsed.links[0]!.href, "real.md");
});

test("setext headings only fire for a preceding paragraph line", () => {
  const parsed = parseMarkdown("A paragraph\n---\n\n- item\n---\n");
  assert.equal(parsed.headings.length, 1);
  assert.deepEqual(parsed.headings[0]!.slug, "a-paragraph");
});

test("images and links inside code spans and front matter are ignored", () => {
  const parsed = parseMarkdown("---\ntitle: x\n---\n\nText `code [inner](x.md)` end\n");
  assert.deepEqual(parsed.links, []);
});

test("scans inline, reference, shortcut, and autolink links with exact positions and hrefs", () => {
  const parsed = parseMarkdown(
    [
      "[inline](guide.md#top) and [full][ref-a] plus [collapsed][] and [shortcut].",
      "",
      "[ref-a]: ../api.md",
      "[collapsed]: https://example.com/x#a",
      "[shortcut]: want.md",
    ].join("\n"),
  );
  assert.equal(parsed.links.length, 4);
  assert.deepEqual(
    parsed.links.map(({ href, line }) => ({ href, line })),
    [
      { href: "guide.md#top", line: 1 },
      { href: "../api.md", line: 1 },
      { href: "https://example.com/x#a", line: 1 },
      { href: "want.md", line: 1 },
    ],
  );
});

test("titles and angle-bracketed destinations parse and degrade gracefully", () => {
  const parsed = parseMarkdown('[t](a.md "title") and [u](<b.md>) and [abbr][m]\n\n[m]: c.md "mine"\n');
  assert.equal(parsed.links.length, 3);
  assert.deepEqual(parsed.links.map(({ href }) => href), ["a.md", "b.md", "c.md"]);
});

test("broken and unknown link syntax degrades to plain text instead of throwing", () => {
  // The mangled forms yield nothing, except the one genuinely valid inline link after "[ref][",
  // which CommonMark reads as the link "[ and ](x.md)".
  const parsed = parseMarkdown("[unclosed]( and [ref][ and ](x.md) and ![img(] and <not a url>\n");
  assert.equal(parsed.links.length, 1);
  assert.equal(parsed.links[0]!.href, "x.md");
});

test("collects images separately from links", () => {
  const parsed = parseMarkdown("![alt text](img.png) and [l](b.md)\n");
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0]!.src, "img.png");
  assert.equal(parsed.links.length, 1);
});

test("buildMarkdownGraph mirrors the site.ts shape over a multi-file repository", () => {
  const graph = buildMarkdownGraph(
    makeSite({
      "README.md": "# Home\n\n[docs](docs/overview.md#scope) and ![logo](docs/logo.png)\n",
      "docs/overview.md": [
        "---",
        "title: Overview",
        "---",
        "",
        "# Overview",
        "",
        "## Scope",
        "",
        "[api cross](api.md), [external](https://example.com/a), [mailto](mailto:a@b.c), [missing lack](../nope.md#top)",
        "",
        "![diagram](async diagram.png)",
      ].join("\n"),
      "docs/api.md": "# API\n",
    }),
  );
  assert.deepEqual([...graph.files.keys()], ["/README.md", "/docs/api.md", "/docs/overview.md"]);
  const readme = graph.files.get("/README.md")!;
  assert.equal(readme.file, "README.md");
  assert.deepEqual(readme.headings.map(({ level, text, slug }) => ({ level, text, slug })), [
    { level: 1, text: "Home", slug: "home" },
  ]);
  assert.deepEqual(readme.headings[0]!.line, 1);
  assert.equal(readme.links.length, 1);
  const docLink = readme.links[0]!;
  assert.equal(docLink.kind, "internal");
  assert.equal(docLink.file, "/docs/overview.md");
  assert.equal(docLink.fragment, "scope");
  assert.equal(graph.headingFor("/docs/overview.md", "scope")!.line, 7);
  assert.equal(graph.headingFor("docs/overview.md", "nosuch"), undefined);
  assert.deepEqual(readme.images.map(({ src, kind, file }) => ({ src, kind, file })), [
    { src: "docs/logo.png", kind: "internal", file: undefined },
  ]);
});

test("sources, headings, and links of the graph are exact for the fixture", () => {
  const graph = buildMarkdownGraph(
    makeSite({
      "a.md": "# Time &amp; again\n\nSame [x](b.md#other) and [x](b.md#other)\n",
      "b.md": "## Other\n## Other\n",
    }),
  );
  const overview = graph.files.get("/a.md")!;
  assert.equal(overview.headings[0]!.text, "Time & again");
  assert.equal(overview.headings[0]!.slug, "time--again");
  assert.deepEqual(overview.links.map(({ path, file, fragment }) => ({ path, file, fragment })), [
    { path: "/b.md", file: "/b.md", fragment: "other" },
    { path: "/b.md", file: "/b.md", fragment: "other" },
  ]);
  assert.deepEqual(graph.files.get("/b.md")!.headings.map(({ slug }) => slug), ["other", "other-1"]);
});

test("internal link kinds and resolution match relative, root-relative, and missing targets", () => {
  const graph = buildMarkdownGraph(makeSite({ "docs/guide.md": "# G\n", "index.md": "# H\n" }));
  const resolve = (from: string, href: string) => resolveTarget(from, href, new Set(graph.files.keys()));
  assert.equal(resolve("/docs/guide.md", "../index.md").file, "/index.md");
  assert.equal(resolve("/docs/guide.md", "/index.md").file, "/index.md");
  assert.equal(resolve("/docs/guide.md", "guide.md#nope").file, "/docs/guide.md");
  assert.equal(resolve("/index.md", "#section").path, "/index.md");
  assert.equal(resolve("/index.md", "#second").fragment, "second");
  assert.equal(resolve("/index.md", "nope.md#x").file, undefined);
  assert.equal(resolve("/index.md", "guide.md%20no.md").file, undefined);
});

test("external and ignored links keep their href and no path", () => {
  const target = resolveTarget("/a.md", "https://example.com", new Set());
  assert.equal(target.kind, "external");
  assert.equal(target.file, undefined);
  for (const href of ["mailto:a@b.c", "tel:1", "javascript:void(0)"]) assert.equal(resolveTarget("/a.md", href, new Set()).kind, "ignored", href);
});

test("markdown graph skips .git and node_modules and only parses Markdown extensions", () => {
  const graph = buildMarkdownGraph(
    makeSite({ "docs/readme.md": "# D\n", "docs/other.markdown": "# E\n", "index.html": "<p>ignored</p>", "notes.txt": "# nope\n" }),
  );
  assert.deepEqual([...graph.files.keys()], ["/docs/other.markdown", "/docs/readme.md"]);
});
