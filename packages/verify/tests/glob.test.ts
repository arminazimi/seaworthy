import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesCheck, matchesGlob } from "../src/glob.js";

test("globs: * stays in a segment, ** crosses segments, ? is one character", () => {
  assert.ok(matchesGlob("*.html", "index.html"));
  assert.ok(!matchesGlob("*.html", "docs/index.html"));
  assert.ok(matchesGlob("docs/*.html", "docs/a.html"));
  assert.ok(!matchesGlob("docs/*.html", "docs/x/a.html"));
  assert.ok(matchesGlob("drafts/**", "drafts/a/b/c.html"));
  assert.ok(matchesGlob("**/index.html", "index.html"), "** also matches zero directories");
  assert.ok(matchesGlob("**/index.html", "a/b/index.html"));
  assert.ok(matchesGlob("page?.html", "page1.html"));
  assert.ok(!matchesGlob("page?.html", "page12.html"));
});

test("globs escape regular-expression characters", () => {
  assert.ok(matchesGlob("a.b(1).html", "a.b(1).html"));
  assert.ok(!matchesGlob("a.html", "aXhtml"));
  assert.ok(!matchesGlob("a+b.html", "aab.html"));
});

test("check patterns: exact IDs and prefix wildcards", () => {
  assert.ok(matchesCheck("links.internal", "links.internal"));
  assert.ok(!matchesCheck("links.internal", "links.external"));
  assert.ok(matchesCheck("a11y.*", "a11y.color-contrast"));
  assert.ok(!matchesCheck("a11y.*", "a11yx.color-contrast"));
  assert.ok(!matchesCheck("a11y.*", "images.alt"));
});

test("globs written with Windows separators match forward-slash site paths", () => {
  assert.ok(matchesGlob("docs\\*.html", "docs/a.html"));
  assert.ok(!matchesGlob("docs\\*.html", "docs/x/a.html"), "* stays within one segment");
  assert.ok(matchesGlob("docs\\**\\a.html", "docs/x/y/a.html"));
  assert.ok(matchesGlob("**\\index.html", "index.html"), "** also matches zero directories");
  assert.ok(matchesGlob("docs\\**", "docs/x/y/deep.html"));
  assert.ok(matchesGlob("docs/über\\*.html", "docs/über/a.html"), "mixed separators still match");
});
