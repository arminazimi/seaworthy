// `seaworthy explain <check-id>`: the docs page in the terminal. The command is a reader of
// docs/checks/<id>.md and of the registry only — these tests pin that it prints the page
// byte-for-byte, never reads a file for an id the registry does not know, and uses only the
// usage exit code for bad invocations.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { builtInChecks } from "../src/checks/index.js";
import { run, EXIT } from "../src/cli.js";

// packages/verify/dist/tests/explain.test.js -> repository root is four levels up.
const DOCS = fileURLToPath(new URL("../../../../docs/checks/", import.meta.url));

/** The page as the CLI promises to print it: the file's text ending in exactly one newline. */
const expected = (id: string): string => readFileSync(join(DOCS, `${id}.md`), "utf8").replace(/\n+$/, "") + "\n";

test("explain prints a check's docs page verbatim, with nothing on stderr", async () => {
  const result = await run(["explain", "images.alt"]);
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stdout, expected("images.alt"));
  assert.equal(result.stderr, "");
  // The page is printed as written: its title and its fix section are in the output.
  assert.ok(result.stdout.startsWith("# images.alt\n"));
  assert.ok(result.stdout.includes("## How to fix"));
});

test("every built-in check's page prints, byte for byte, from the registry id alone", async () => {
  for (const check of builtInChecks) {
    const result = await run(["explain", check.meta.id]);
    assert.equal(result.code, EXIT.ok, check.meta.id);
    assert.equal(result.stdout, expected(check.meta.id), check.meta.id);
    assert.equal(result.stderr, "", check.meta.id);
  }
});

test("explain is deterministic: the same invocation twice gives the same bytes", async () => {
  const first = await run(["explain", "meta.lang"]);
  const second = await run(["explain", "meta.lang"]);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(first, second);
});

test("an unknown check id is a usage error, not a file read or an invented page", async () => {
  const result = await run(["explain", "no.such-check"]);
  assert.equal(result.code, EXIT.usage);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unknown check id "no\.such-check"/);
});

test("an id with path separators names no check and reaches no file", async () => {
  for (const id of ["../README", "..\\..\\docs", "a11y/axe", "images.alt.md"]) {
    const result = await run(["explain", id]);
    assert.equal(result.code, EXIT.usage, id);
    assert.equal(result.stdout, "", id);
  }
});

test("a missing or extra argument, and any option, are usage errors", async () => {
  const bare = await run(["explain"]);
  assert.equal(bare.code, EXIT.usage);
  assert.match(bare.stderr, /needs a check id/);

  const extra = await run(["explain", "images.alt", "meta.lang"]);
  assert.equal(extra.code, EXIT.usage);
  assert.match(extra.stderr, /takes one check id/);

  const option = await run(["explain", "--format", "images.alt"]);
  assert.equal(option.code, EXIT.usage);
});

test("without a docs page in the install, explain degrades to the check's own metadata", async () => {
  const result = await run(["explain", "images.alt"], { docsDir: "/nonexistent/seaworthy-docs" });
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /is not part of this install/);
  assert.ok(result.stdout.includes("# images.alt\n"));
  // The lines come from the registry, so they match the metadata exactly.
  const meta = builtInChecks.find((check) => check.meta.id === "images.alt")!.meta;
  assert.ok(result.stdout.includes(meta.title), "title");
  assert.ok(result.stdout.includes(`Severity: ${meta.severity}`), "severity");
  assert.ok(result.stdout.includes(`Docs: ${meta.docs}`), "docs URL");
  // No page text leaks in.
  assert.ok(!result.stdout.includes("## How to fix"));
});
