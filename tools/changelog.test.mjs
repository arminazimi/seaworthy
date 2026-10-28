import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fold, readFragments } from "./changelog.mjs";

const make = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "changelog-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};

test("fold puts fragments first in an existing section, newest issue first", () => {
  const dir = make({ "1.added.md": "Old (#1).\n", "2.added.md": "New (#2).\n" });
  const out = fold("# Changelog\n\n## Unreleased\n\n### Added\n\n- Existing.\n\n## 0.1.0\n", readFragments(dir));
  assert.equal(out, "# Changelog\n\n## Unreleased\n\n### Added\n\n- New (#2).\n- Old (#1).\n- Existing.\n\n## 0.1.0\n");
});

test("fold creates a missing section under Unreleased", () => {
  const dir = make({ "3.fixed.md": "Fix (#3)." });
  const out = fold("# Changelog\n\n## Unreleased\n\n### Added\n\n- A.\n", readFragments(dir));
  assert.match(out, /## Unreleased\n\n### Fixed\n\n- Fix \(#3\)\.\n\n### Added/);
});

test("bad names and bodies are rejected", () => {
  assert.throws(() => readFragments(make({ "oops.md": "x" })), /name must be/);
  assert.throws(() => readFragments(make({ "4.added.md": "- bullet" })), /no leading/);
});
