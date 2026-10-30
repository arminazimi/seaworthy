import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { MIRRORS, MIRRORED_SECTIONS, SOURCE, extractSection, renderMirror, renderMirrors } from "./agent-rules.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, SOURCE), "utf8");

const SYNTHETIC = [
  "# AGENTS.md",
  "",
  "Intro.",
  "",
  "## Setup and commands",
  "",
  "```bash",
  "npm ci",
  "```",
  "",
  "## Repository layout",
  "",
  "Not mirrored.",
  "",
  "## Trust rules",
  "",
  "- A rule.",
  "",
  "### A level-3 heading",
  "",
  "- Still inside Trust rules.",
  "",
  "## Shared files: append-only, regenerate, or never touch",
  "",
  "| Path | Rule | How |",
  "",
  "## More",
  "",
].join("\n");

test("extractSection copies a level-2 section verbatim, up to the next level-2 heading", () => {
  assert.equal(extractSection(SYNTHETIC, "Setup and commands"), "## Setup and commands\n\n```bash\nnpm ci\n```\n");
  assert.equal(extractSection(SYNTHETIC, "Trust rules"), "## Trust rules\n\n- A rule.\n\n### A level-3 heading\n\n- Still inside Trust rules.\n");
  assert.equal(extractSection(SYNTHETIC, "Shared files: append-only, regenerate, or never touch"), "## Shared files: append-only, regenerate, or never touch\n\n| Path | Rule | How |\n");
});

test("extractSection fails clearly when the heading is absent", () => {
  assert.throws(() => extractSection(SYNTHETIC, "Nope"), /AGENTS\.md has no "## Nope" section/);
});

test("AGENTS.md still carries every mirrored section", () => {
  for (const title of MIRRORED_SECTIONS) extractSection(source, title);
  assert.deepEqual(MIRRORED_SECTIONS, [
    "Setup and commands",
    "Trust rules",
    "Shared files: append-only, regenerate, or never touch",
  ]);
});

test("every committed mirror is byte-identical to what agent-rules.mjs renders", () => {
  for (const [file, content] of renderMirrors(source)) {
    const path = join(root, file);
    assert.ok(existsSync(path), `${file} is missing — run \`node tools/agent-rules.mjs\``);
    assert.equal(readFileSync(path, "utf8"), content, `${file} drifted from ${SOURCE} — run \`node tools/agent-rules.mjs\``);
  }
});

test("the mirrored sections appear verbatim in every mirror — one source, no drift", () => {
  for (const { file } of MIRRORS) {
    const text = readFileSync(join(root, file), "utf8");
    for (const title of MIRRORED_SECTIONS) {
      assert.ok(text.includes(extractSection(source, title)), `${file} must contain "## ${title}" exactly as in ${SOURCE}`);
    }
  }
});

test("a mirror renders deterministically: stable, frontmatter only where the tool needs it, one trailing newline", () => {
  for (const mirror of MIRRORS) {
    const once = renderMirror(mirror, source);
    assert.equal(once, renderMirror(mirror, source));
    assert.ok(once.endsWith("\n") && !once.endsWith("\n\n"));
    assert.ok(once.includes(mirror.sourceLink), `${mirror.file} links back to ${SOURCE}`);
    const hasFrontmatter = mirror.file.endsWith(".mdc");
    assert.equal(once.startsWith("---\n"), hasFrontmatter);
    if (hasFrontmatter) assert.ok(once.includes("alwaysApply: true"));
  }
});

test("editing a mirrored section in AGENTS.md changes the render (drift cannot hide)", () => {
  for (const mirror of MIRRORS) {
    const edited = source.replace("- Seaworthy reports and suggests.", "- Seaworthy reports and edits files.");
    assert.notEqual(renderMirror(mirror, edited), renderMirror(mirror, source));
  }
});

test("the gate runs the drift check, and keeps it ahead of the schema line", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["agent-rules:build"], "node tools/agent-rules.mjs");
  assert.equal(pkg.scripts["check:agent-rules"], "node tools/agent-rules.mjs --check");
  const steps = pkg.scripts.check.split("&&").map((step) => step.trim());
  assert.ok(steps.includes("npm run check:agent-rules"), `npm run check must run check:agent-rules: ${steps.join(" && ")}`);
  assert.ok(steps.indexOf("npm run check:agent-rules") < steps.indexOf("npm run check:schema"), "check:schema stays the last line of npm run check");
});

test("the in-repo gate CLI exits 0 with its OK line while the mirrors are in sync", () => {
  const run = spawnSync(process.execPath, [join(root, "tools", "agent-rules.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^OK: agent rules \\(${MIRRORS.length} mirrors in sync with ${SOURCE}\\)`));
});

test("node tools/agent-rules.mjs writes the mirrors and --check accepts them; a missing or drifted mirror fails", () => {
  const tmp = mkdtempSync(join(tmpdir(), "agent-rules-"));
  try {
    // A repository that has AGENTS.md and the tool but no mirrors yet.
    writeFileSync(join(tmp, SOURCE), source);
    mkdirSync(join(tmp, "tools"));
    copyFileSync(join(root, "tools", "agent-rules.mjs"), join(tmp, "tools", "agent-rules.mjs"));
    const script = join(tmp, "tools", "agent-rules.mjs");
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

    const missing = run("--check");
    assert.equal(missing.status, 1, missing.stderr);
    for (const { file } of MIRRORS) assert.match(missing.stderr, new RegExp(`missing ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    const written = run();
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stdout, new RegExp(`Wrote ${MIRRORS.length} mirrors from ${SOURCE}`));
    for (const [file, content] of renderMirrors(source)) {
      assert.equal(readFileSync(join(tmp, file), "utf8"), content, `${file} must be the render`);
    }

    const synced = run("--check");
    assert.equal(synced.status, 0, synced.stderr);
    assert.match(synced.stdout, new RegExp(`^OK: agent rules \\(${MIRRORS.length} mirrors in sync with ${SOURCE}\\)`));

    // A hand-edit in the tool's own file is drift, not a preference.
    const editedFile = join(tmp, MIRRORS[0].file);
    writeFileSync(editedFile, `${readFileSync(editedFile, "utf8")}\n## A section nobody approved\n`);
    const drifted = run("--check");
    assert.equal(drifted.status, 1, `${MIRRORS[0].file} drifted must fail the check`);
    assert.match(drifted.stderr, new RegExp(`${MIRRORS[0].file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} drifted from ${SOURCE}`));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
