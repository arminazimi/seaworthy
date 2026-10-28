import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { buildReport, reportToJson } from "@seaworthy/verify";
import type { Finding } from "@seaworthy/verify";

import { COMMENT_FILE, EXIT, commentBody, prCommentArgs, prCommentSteps, run, type GhRunner } from "../src/pr-comment.js";

const missingAlt: Finding = {
  checkId: "images.alt",
  severity: "warning",
  message: '<img src="/a.png"> has no alt attribute.',
  location: { file: "docs/link.html", line: 5 },
  fix: { kind: "edit", summary: "Add alt text.", edits: [], appliesTo: "built-output" },
  fingerprint: "bbbbbbbb22222222",
};
const noCharset: Finding = {
  checkId: "html.charset",
  severity: "error",
  message: "No character encoding is declared.",
  location: { file: "a.html", line: 1 },
  fix: { kind: "edit", summary: "Declare a charset in the head.", edits: [], appliesTo: "built-output" },
  fingerprint: "dddddddd44444444",
};

const made: string[] = [];

/** A temp cwd with two report files: one before the fix, one after. */
function reportsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-action-test-"));
  made.push(dir);
  const before = buildReport({ root: "before", pages: 2, checks: [], findings: [missingAlt, noCharset] });
  const after = buildReport({ root: "after", pages: 2, checks: [], findings: [missingAlt] });
  writeFileSync(join(dir, "before.json"), reportToJson(before));
  writeFileSync(join(dir, "after.json"), reportToJson(after));
  return dir;
}

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const EXPECTED_BODY = `## Seaworthy: 0 new, 1 fixed

\`after\`: 2 findings before, 1 finding after, 1 unchanged.

**Fixed**

| Severity | Check | Location | Problem |
| --- | --- | --- | --- |
| error | \`html.charset\` | \`a.html:1\` | No character encoding is declared. |

<!-- seaworthy:pr-comment -->
`;

test("the comment body is the deterministic markdown of the diff between two report files", () => {
  const dir = reportsDir();
  assert.equal(commentBody("before.json", "after.json", dir), EXPECTED_BODY);
  assert.equal(commentBody("before.json", "after.json", dir), commentBody("before.json", "after.json", dir), "the same reports build the same body");
});

test(`run body writes ${COMMENT_FILE} and says so`, () => {
  const dir = reportsDir();
  const result = run(["body", "--before", "before.json", "--after", "after.json"], { cwd: dir });
  assert.equal(result.code, EXIT.ok, result.stderr);
  assert.equal(result.stdout, `seaworthy: comment body written to ${COMMENT_FILE}\n`);
  assert.equal(readFileSync(join(dir, ...COMMENT_FILE.split("/")), "utf8"), EXPECTED_BODY, "the file holds the comment, ready to post");
  const second = run(["body", "--before=before.json", "--after=after.json", "--out=comment.md"], { cwd: dir });
  assert.equal(second.code, EXIT.ok, second.stderr);
  assert.equal(readFileSync(join(dir, "comment.md"), "utf8"), EXPECTED_BODY, "--out decides where the body goes");
});

test("run post passes the exact gh argument list, in order, to the gh runner", () => {
  const posted: string[][] = [];
  const fake: GhRunner = (argv) => {
    posted.push([...argv]);
    return { code: EXIT.ok, stdout: "seaworthy-action-tests/123#issuecomment-1\n", stderr: "" };
  };
  const result = run(["post", "--repo", "seaworthy-action-tests", "--pr", "123", "--body-file", ".seaworthy/comment.md"], { gh: fake });
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stdout, "seaworthy-action-tests/123#issuecomment-1\n");
  assert.deepEqual(posted, [["pr", "comment", "123", "--repo", "seaworthy-action-tests", "--body-file", ".seaworthy/comment.md"]], "exactly the documented argument order");
  assert.deepEqual(prCommentArgs({ repo: "o/r", pr: 45, bodyFile: "b.md" }), ["pr", "comment", "45", "--repo", "o/r", "--body-file", "b.md"], "the builder and the command agree");
});

test("run explains wrong usage for both commands", () => {
  for (const argv of [[], ["nope"], ["body"], ["body", "--before", "b.json"], ["body", "--wat"], ["post", "--repo", "o/r"], ["post", "--pr", "1"], ["post", "--repo", "o/r"]]) {
    const result = run(argv, {});
    assert.equal(result.code, EXIT.usage, argv.join(" "));
    assert.match(result.stderr, /^seaworthy action: /);
    assert.match(result.stderr, /pr-comment body --before/);
  }
});

test("prCommentSteps are two plain run steps the composite action can wire", () => {
  const steps = prCommentSteps({ repo: "o/r", pr: "7", bodyFile: COMMENT_FILE, before: "before.json", after: "after.json" });
  assert.equal(steps.length, 2);
  assert.equal(steps[0]!.name, "Build the Seaworthy comment body");
  assert.match(steps[0]!.run, /^node "/);
  assert.ok(steps[0]!.run.includes(`body --before before.json --after after.json --out ${COMMENT_FILE}`));
  assert.equal(steps[1]!.name, "Post the Seaworthy comment");
  assert.ok(steps[1]!.run.includes(`post --repo o/r --pr "7" --body-file ${COMMENT_FILE}`));
});

test("a missing report file makes the step crash with exit 4, not a comment", () => {
  const dir = reportsDir();
  const result = run(["body", "--before", "missing.json", "--after", "after.json"], { cwd: dir });
  assert.equal(result.code, EXIT.internal);
  assert.match(result.stderr, /^seaworthy action: cannot read report /);
  assert.ok(!existsSync(join(dir, ...COMMENT_FILE.split("/"))), "no body file is written when the before report is unreadable");
});
