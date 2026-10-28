// Folds changelog.d/<issue>.<section>.md fragments into CHANGELOG.md under "## Unreleased".
// Usage: node tools/changelog.mjs [--check]   (--check validates fragments and writes nothing)

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SECTIONS = ["added", "changed", "fixed"];
const NAME = /^(\d+)\.(added|changed|fixed)\.md$/;

/** Reads fragments as { section, issue, file, text }, sorted by issue number; throws on a bad name or body. */
export function readFragments(dir) {
  if (!existsSync(dir)) return [];
  const fragments = [];
  for (const file of readdirSync(dir).sort()) {
    if (file === "README.md") continue;
    const match = NAME.exec(file);
    if (!match) throw new Error(`changelog.d/${file}: name must be <issue>.<added|changed|fixed>.md`);
    const text = readFileSync(join(dir, file), "utf8").trim();
    if (text === "" || text.includes("\n") || text.startsWith("- ")) throw new Error(`changelog.d/${file}: must be one paragraph of entry text with no leading "- "`);
    fragments.push({ section: match[2], issue: Number(match[1]), file, text });
  }
  return fragments.sort((a, b) => b.issue - a.issue || a.file.localeCompare(b.file));
}

/** Inserts each fragment as the first entry of its "### Section" under "## Unreleased". */
export function fold(changelog, fragments) {
  let out = changelog;
  for (const section of SECTIONS) {
    const entries = fragments.filter((f) => f.section === section).map((f) => `- ${f.text}`);
    if (entries.length === 0) continue;
    const heading = `### ${section[0].toUpperCase()}${section.slice(1)}\n\n`;
    const unreleased = out.indexOf("## Unreleased");
    if (unreleased === -1) throw new Error('CHANGELOG.md has no "## Unreleased" section');
    const next = out.indexOf("\n## ", unreleased + 1);
    const end = next === -1 ? out.length : next;
    const at = out.indexOf(heading, unreleased);
    if (at !== -1 && at < end) {
      const start = at + heading.length;
      out = out.slice(0, start) + entries.join("\n") + "\n" + out.slice(start);
    } else {
      const start = out.indexOf("\n", unreleased) + 1;
      out = out.slice(0, start) + `\n${heading}${entries.join("\n")}\n` + out.slice(start);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "changelog.d");
  const fragments = readFragments(dir);
  if (process.argv.includes("--check")) {
    console.log(`OK: changelog (${fragments.length} fragments)`);
  } else {
    const path = join(root, "CHANGELOG.md");
    writeFileSync(path, fold(readFileSync(path, "utf8"), fragments));
    for (const f of fragments) rmSync(join(dir, f.file));
    console.log(`folded ${fragments.length} fragments into CHANGELOG.md`);
  }
}
