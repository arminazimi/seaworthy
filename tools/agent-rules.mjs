// Keeps the instruction files for agent tools that do not read AGENTS.md — Cursor, Copilot,
// Gemini CLI — byte-identical to the sections every agent must obey: the commands, the trust
// rules, and the shared-file table. AGENTS.md is the one source; the mirrors carry no advice of
// their own, so any wording difference between a mirror and AGENTS.md is a drift bug.
//
//   npm run agent-rules:build   # rewrite the mirrors from AGENTS.md
//   npm run check:agent-rules   # fail if a mirror is missing or drifted; part of `npm run check`
//
// tools/agent-rules.test.mjs runs the same equality test, so `npm test` covers it too.
// Output is deterministic across platforms: mirrored sections are copied verbatim, LF line
// endings, trailing newline. Tools that read AGENTS.md natively (Codex and similar) get no
// mirror file.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE = "AGENTS.md";

/** Level-2 headings copied verbatim into every mirror, in this order. */
export const MIRRORED_SECTIONS = [
  "Setup and commands",
  "Trust rules",
  "Shared files: append-only, regenerate, or never touch",
];

/** One instruction file per tool that reads its own rules file instead of AGENTS.md. */
export const MIRRORS = [
  {
    file: ".cursor/rules/seaworthy.mdc",
    tool: "Cursor",
    sourceLink: "../../AGENTS.md",
    frontmatter: '---\ndescription: Seaworthy repository rules, mirrored from AGENTS.md\nglobs:\nalwaysApply: true\n---\n\n',
  },
  {
    file: ".github/copilot-instructions.md",
    tool: "GitHub Copilot",
    sourceLink: "../AGENTS.md",
  },
  {
    file: "GEMINI.md",
    tool: "Gemini CLI",
    sourceLink: "AGENTS.md",
  },
];

/** The `## title` section of a Markdown document, verbatim, up to (not including) the next
 * level-2 heading; ends with exactly one newline. Throws when the heading is absent. */
export function extractSection(markdown, title) {
  const heading = `## ${title}`;
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`${SOURCE} has no "${heading}" section`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end += 1;
  while (end > start + 1 && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end).join("\n") + "\n";
}

/** Render one mirror from the AGENTS.md source text. */
export function renderMirror(mirror, source) {
  const blocks = MIRRORED_SECTIONS.map((title) => extractSection(source, title).trimEnd());
  const body = [
    `# ${mirror.tool} instructions — Seaworthy`,
    "",
    `Generated from [${SOURCE}](${mirror.sourceLink}) by \`npm run agent-rules:build\`;`,
    `\`npm run check\` fails when the sections below drift from it`,
    `(\`node tools/agent-rules.mjs --check\`). Do not edit them here: edit`,
    `AGENTS.md and regenerate. The mirrors exist so that tools which read their own rules file`,
    `still get the same commands, the same trust rules, and the same shared-file table as every`,
    `other agent — no advice beyond AGENTS.md.`,
    "",
    blocks.join("\n\n"),
    "",
    "## Also",
    "",
    "- Run `npm run check` before you say a change is done.",
    "- One issue = one pull request. If you find more work, open a follow-up issue instead.",
    `- Everything not mirrored here — repository layout, working on an issue, conventions — is in [${SOURCE}](${mirror.sourceLink}).`,
    "- Agent tools that read `AGENTS.md` natively (Codex and similar) need no mirror file; these three exist for the tools that do not.",
    "",
  ].join("\n");
  return (mirror.frontmatter ?? "") + body;
}

/** All mirrors as [[relativePath, content]] — deterministic, so --check is an equality test. */
export function renderMirrors(source) {
  return MIRRORS.map((mirror) => [mirror.file, renderMirror(mirror, source)]);
}

function main() {
  const check = process.argv.includes("--check");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = join(root, SOURCE);
  if (!existsSync(sourcePath)) {
    console.error(`agent-rules: missing ${SOURCE}`);
    process.exit(1);
  }
  const files = renderMirrors(readFileSync(sourcePath, "utf8"));
  const problems = [];
  for (const [rel, content] of files) {
    const path = join(root, rel);
    if (check) {
      if (!existsSync(path)) problems.push(`missing ${rel}`);
      else if (readFileSync(path, "utf8") !== content) problems.push(`${rel} drifted from ${SOURCE}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  if (problems.length) {
    console.error(problems.map((p) => `agent-rules: ${p}`).join("\n"));
    console.error(`agent-rules: regenerate with \`node tools/agent-rules.mjs\``);
    process.exit(1);
  }
  console.log(check
    ? `OK: agent rules (${files.length} mirrors in sync with ${SOURCE})`
    : `Wrote ${files.length} mirrors from ${SOURCE}`);
}

// Run only when executed directly, not when imported by tests. Compares realpaths so the
// CLI still starts when tests spawn the tool from a symlinked temp dir (macOS /tmp).
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
