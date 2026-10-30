// Unit tests for the `fix_preview` tool: the unified diff it returns for fixable findings, the
// honest empty result when nothing is plannable, the refusals, and the invariant that the tree
// is untouched — the tool has no mode that writes. Offline and deterministic: custom checks only.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { Check } from "@seaworthy/verify";

import { FIX_PREVIEW_DESCRIPTION, FIX_PREVIEW_INPUT, FIX_PREVIEW_NAME, fixPreviewReport } from "../src/fix-preview.js";
import type { FixPreviewOutput } from "../src/fix-preview.js";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A workspace folder with the given files, cleaned up after the test file. */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-mcp-fix-"));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

/** Every path and byte under a folder, so a test can prove the tool touched and created nothing. */
function snapshot(root: string, at = root, out = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    if (entry.isDirectory()) snapshot(root, path, out);
    else out.set(path, readFileSync(path, "utf8"));
  }
  return out;
}

const INDEX = ['<!doctype html>', '<html lang="en">', "<head><title>Home</title></head>", "<body>", "<main><h1>Home</h1></main>", "</body>", "</html>"].join("\n") + "\n";
const ABOUT = ['<!doctype html>', '<html lang="en">', "<head><title>About</title></head>", "<body>", "<main><h1>About</h1></main>", "</body>", "</html>"].join("\n") + "\n";

/** One check whose findings are fully described by the test, so the diff is knowable here. */
function makeCheck(id: string, draft: { message: string; file: string; line: number; find: string; replace: string; kind?: "edit" | "manual"; needsInput?: boolean }): Check {
  return {
    meta: { id, title: id, severity: "warning", needs: ["html"], docs: "https://example.test/x", standards: [] },
    run: (ctx) =>
      [...ctx.site.pages.values()]
        .filter((page) => page.file === draft.file)
        .map((page) => ({
          message: draft.message,
          location: { file: page.file, line: draft.line, column: 1 },
          fix:
            draft.kind === "manual"
              ? { kind: "manual" as const, summary: `${id} is a person's call` }
              : {
                  kind: "edit" as const,
                  summary: `replace ${JSON.stringify(draft.find)} with ${JSON.stringify(draft.replace)}`,
                  edits: [{ file: page.file, line: draft.line, action: "replace" as const, find: draft.find, replace: draft.replace, ...(draft.needsInput ? { needsInput: true } : {}) }],
                },
          key: page.url,
        })),
  };
}

/** The same page set the fix path sees, plus one finding whose anchor is gone and two that can
 *  never become hunks, so both sides of the preview are covered by one run. */
const CHECKS = [
  makeCheck("preview.lang", { message: "lang is too broad", file: "index.html", line: 2, find: '<html lang="en">', replace: '<html lang="en-GB">' }),
  // The identical edit on the second page: planned on its own, and deduplicated when repeated.
  makeCheck("preview.lang2", { message: "lang is too broad", file: "about.html", line: 2, find: '<html lang="en">', replace: '<html lang="en-GB">' }),
  makeCheck("preview.dupe", { message: "the same lang problem", file: "index.html", line: 2, find: '<html lang="en">', replace: '<html lang="en-GB">' }),
  makeCheck("preview.stale", { message: "the anchor moved", file: "index.html", line: 5, find: "<p>NOT THERE</p>", replace: "<p>x</p>" }),
  makeCheck("preview.input", { message: "a person must write it", file: "index.html", line: 5, find: "<main><h1>Home</h1></main>", replace: "<main><h1>Home</h1><p>new copy</p></main>", needsInput: true }),
  makeCheck("preview.manual", { message: "subjective", file: "index.html", line: 3, find: "<title>Home</title>", replace: "<title>Better</title>", kind: "manual" }),
];

const parse = (text: string): FixPreviewOutput => JSON.parse(text) as FixPreviewOutput;

/** Structurally validates one unified diff the way `git apply` reads it; returns the file sections. */
function parseDiff(diff: string): Array<{ file: string; added: string[] }> {
  const sections: Array<{ file: string; added: string[] }> = [];
  // Every diff section ends its last line with "\n"; drop only that final empty piece.
  const lines = (diff.endsWith("\n") ? diff.slice(0, -1) : diff).split("\n");
  let i = 0;
  while (i < lines.length) {
    const header = /^diff --git a\/(\S+) b\/\1$/.exec(lines[i] ?? "");
    assert.ok(header, `line ${i} must open a file section, got ${JSON.stringify(lines[i])}`);
    assert.equal(lines[i + 1], `--- a/${header[1]}`);
    assert.equal(lines[i + 2], `+++ b/${header[1]}`);
    const section = { file: header[1] as string, added: [] as string[] };
    i += 3;
    while (i < lines.length && (lines[i] ?? "").startsWith("@@ ")) {
      assert.match(lines[i] ?? "", /^@@ -\d+,\d+ \+\d+,\d+ @@$/, "hunk headers carry line counts");
      i++;
      while (i < lines.length && /^[ +\\-]/.test(lines[i] ?? "") && !(lines[i] ?? "").startsWith("diff --git")) {
        const line = lines[i] ?? "";
        if (line.startsWith("+")) section.added.push(line.slice(1));
        i++;
      }
    }
    sections.push(section);
  }
  return sections;
}

test("fix_preview is registered as a preview-only tool over a folder to verify", () => {
  assert.equal(FIX_PREVIEW_NAME, "fix_preview");
  // The input is a built site folder to verify — not a report JSON, not a single finding.
  assert.deepEqual(Object.keys(FIX_PREVIEW_INPUT), ["site"]);
  assert.match(FIX_PREVIEW_DESCRIPTION, /ONE unified diff/);
  assert.match(FIX_PREVIEW_DESCRIPTION, /write nothing: there is no mode that writes/);
});

test("fix_preview returns every suggested edit as one parseable unified diff and writes nothing", async () => {
  const cwd = workspace({ "dist/index.html": INDEX, "dist/about.html": ABOUT });
  const before = snapshot(cwd);
  const text = await fixPreviewReport({ site: "dist" }, { cwd, checks: CHECKS });
  const out = parse(text);

  assert.deepEqual(Object.keys(out), ["spec", "root", "written", "note", "diff", "edits", "files", "manual"], "field order is part of the deterministic output");
  assert.equal(out.root, "dist");
  assert.equal(out.written, false);
  assert.match(out.note, /preview/i);
  assert.match(out.note, /nothing was written/i);

  // The deduplicated lang edit plus the second page: two edits in two files, in sorted order.
  assert.equal(out.edits, 2);
  assert.equal(out.files, 2);
  const sections = parseDiff(out.diff);
  assert.deepEqual(sections.map((s) => s.file), ["about.html", "index.html"]);
  for (const section of sections) {
    assert.ok(section.added.includes('<html lang="en-GB">'), "the replacement line is in the diff");
    assert.ok(section.added.length === 1, "one changed line per file");
  }

  const untouched = snapshot(cwd);
  assert.deepEqual(untouched, before, "the tool wrote nothing anywhere in the tree");
});

test("fix_preview degrades what it cannot anchor to manual guidance instead of guessing hunks", async () => {
  const cwd = workspace({ "dist/index.html": INDEX, "dist/about.html": ABOUT });
  const out = parse(await fixPreviewReport({ site: "dist" }, { cwd, checks: CHECKS }));
  // Report order, not an error: each un-plannable finding is listed with its own reason.
  assert.deepEqual(out.manual.map((m) => m.checkId).sort(), ["preview.input", "preview.manual", "preview.stale"]);
  const reasons = new Map(out.manual.map((m) => [m.checkId, m.reason]));
  assert.match(reasons.get("preview.stale")!, /stale anchor/);
  assert.match(reasons.get("preview.input")!, /needs input/);
  assert.match(reasons.get("preview.manual")!, /manual/);
  // The finding hint travels with each entry so the caller can still fix it by hand.
  for (const m of out.manual) assert.equal(typeof m.summary, "string");
});

test("a run without plannable edits is an honest empty preview, not an error", async () => {
  const cwd = workspace({ "dist/index.html": INDEX });
  const before = snapshot(cwd);
  const text = await fixPreviewReport({ site: "dist" }, { cwd, checks: [makeCheck("preview.manual", { message: "subjective", file: "index.html", line: 3, find: "<title>Home</title>", replace: "<title>Better</title>", kind: "manual" })] });
  const out = parse(text);
  assert.equal(out.diff, "");
  assert.equal(out.edits, 0);
  assert.equal(out.files, 0);
  assert.equal(out.manual.length, 1);
  assert.equal(out.written, false, "the no-write guarantee holds in the empty case too");
  assert.deepEqual(snapshot(cwd), before);
});

test("a caller asking to write files gets refused: there is no write mode to ask in", async () => {
  const cwd = workspace({ "dist/index.html": INDEX });
  const before = snapshot(cwd);
  // No key of the input schema or its description offers writing.
  assert.deepEqual(Object.keys(FIX_PREVIEW_INPUT).filter((k) => /write|apply|fix|edit/i.test(k)), []);
  // Asking anyway changes nothing: unknown inputs carry no meaning, and the result repeats the guarantee.
  const out = parse(await fixPreviewReport({ site: "dist", write: true, apply: true } as never, { cwd, checks: CHECKS }));
  assert.equal(out.written, false);
  assert.match(out.note, /never edits files/);
  assert.deepEqual(snapshot(cwd), before, "the refused request still created and changed nothing");
});

test("fix_preview explains that the site was not built", async () => {
  const cwd = workspace({ "README.md": "x" });
  await assert.rejects(() => fixPreviewReport({}, { cwd, checks: CHECKS }), /no built site found.*dist, build, out, public, _site, site/);
  await assert.rejects(() => fixPreviewReport({ site: "missing" }, { cwd, checks: CHECKS }), /no folder missing/);
  await assert.rejects(() => fixPreviewReport({ site: "README.md" }, { cwd, checks: CHECKS }), /not a folder/);
});

test("fix_preview output is byte-identical across calls: deterministic order, no timestamps", async () => {
  const cwd = workspace({ "dist/index.html": INDEX, "dist/about.html": ABOUT });
  const one = await fixPreviewReport({ site: "dist" }, { cwd, checks: CHECKS });
  const two = await fixPreviewReport({ site: "dist" }, { cwd, checks: CHECKS });
  assert.equal(one, two);
  assert.equal(/20\d\d-\d\d-\d\d/.test(one), false, "the result carries no un-pinnable timestamps");
});
