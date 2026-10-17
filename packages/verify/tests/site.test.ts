import assert from "node:assert/strict";
import { test } from "node:test";

import { attr, buildSite, positionOf } from "../src/site.js";
import { makeSite } from "./helpers.js";

const PAGE = (body: string) => `<!doctype html>\n<html lang="en">\n<head><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

test("builds pages with URLs, ids, and a sorted file list", () => {
  const site = buildSite(
    makeSite({
      "index.html": PAGE('<h1 id="top">Home</h1>'),
      "docs/guide.html": PAGE('<h2 id="a">A</h2><h2 id="b">B</h2>'),
      "logo.png": "png",
      "assets/app.css": "body{}",
    }),
  );
  assert.deepEqual([...site.pages.keys()], ["/docs/guide.html", "/index.html"]);
  assert.deepEqual([...site.pages.get("/docs/guide.html")!.ids].sort(), ["a", "b"]);
  assert.deepEqual([...site.files], ["/assets/app.css", "/docs/guide.html", "/index.html", "/logo.png"]);
  assert.equal(site.pages.get("/index.html")!.file, "index.html");
});

test("skips .git and node_modules", () => {
  const site = buildSite(makeSite({ "index.html": PAGE(""), ".git/config": "x", "node_modules/p/index.html": PAGE("") }));
  assert.deepEqual([...site.files], ["/index.html"]);
});

test("elements carry exact source positions", () => {
  const site = buildSite(makeSite({ "index.html": PAGE('<p>x</p>\n  <a class="c" href="/b.html">b</a>') }));
  const page = site.pages.get("/index.html")!;
  const link = page.elements.find((e) => e.tagName === "a")!;
  assert.equal(attr(link, "href"), "/b.html");
  const element = positionOf(link)!;
  const href = positionOf(link, "href")!;
  assert.deepEqual(element, { line: 6, column: 3 });
  assert.equal(page.source.split("\n")[href.line - 1]!.slice(href.column - 1, href.column + 3), "href");
});

test("resolves links the way a static host serves them", () => {
  const site = buildSite(
    makeSite({
      "index.html": PAGE(""),
      "docs/index.html": PAGE(""),
      "docs/guide.html": PAGE('<h1 id="top">G</h1>'),
      "about.html": PAGE(""),
    }),
  );
  const internal = (from: string, href: string) => {
    const t = site.resolveLink(from, href);
    assert.equal(t.kind, "internal", href);
    return t.kind === "internal" ? t : undefined!;
  };
  assert.equal(internal("/index.html", "/docs/guide.html").file, "/docs/guide.html");
  assert.equal(internal("/index.html", "/docs/guide").file, "/docs/guide.html", "extensionless URL serves .html");
  assert.equal(internal("/index.html", "/docs/").file, "/docs/index.html", "trailing slash serves the index");
  assert.equal(internal("/index.html", "/docs").file, "/docs/index.html", "bare directory serves the index");
  assert.equal(internal("/docs/guide.html", "../about.html").file, "/about.html", "relative path");
  assert.equal(internal("/docs/guide.html", "./index.html").file, "/docs/index.html");
  assert.equal(internal("/docs/guide.html", "#top").file, "/docs/guide.html", "fragment-only link points at the same page");
  assert.equal(internal("/docs/guide.html", "#top").fragment, "top");
  assert.equal(internal("/index.html", "/about.html?x=1#y").path, "/about.html", "query is dropped");
  assert.equal(internal("/index.html", "/missing.html").file, undefined);
});

test("classifies external and ignored links", () => {
  const site = buildSite(makeSite({ "index.html": PAGE("") }));
  for (const href of ["https://example.com/a", "http://x.test", "//cdn.example.com/x.js", "ftp://h/f"]) assert.equal(site.resolveLink("/index.html", href).kind, "external", href);
  for (const href of ["mailto:a@b.c", "tel:+1", "javascript:void(0)", "data:text/plain,hi", ""]) assert.equal(site.resolveLink("/index.html", href).kind, "ignored", href);
});

test("decodes percent-encoded paths and fragments", () => {
  const site = buildSite(makeSite({ "index.html": PAGE(""), "a b.html": PAGE("") }));
  const t = site.resolveLink("/index.html", "/a%20b.html#caf%C3%A9");
  assert.equal(t.kind === "internal" && t.file, "/a b.html");
  assert.equal(t.kind === "internal" && t.fragment, "café");
});

test("pageFor serves directory indexes and extensionless URLs", () => {
  const site = buildSite(makeSite({ "docs/index.html": PAGE(""), "about.html": PAGE("") }));
  assert.equal(site.pageFor("/docs/")?.url, "/docs/index.html");
  assert.equal(site.pageFor("/about")?.url, "/about.html");
  assert.equal(site.pageFor("/nope"), undefined);
});

test("throws when the root is not a directory", () => {
  const root = makeSite({ "file.txt": "x" });
  assert.throws(() => buildSite(`${root}/file.txt`), /not a directory/);
  assert.throws(() => buildSite(`${root}/missing`));
});
