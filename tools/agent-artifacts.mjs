// Generates the well-known agent files a site must publish to advertise Seaworthy itself:
// the Agent Skills index for the two skills under skills/ and the MCP Server Card derived
// from packages/mcp/server.json. The reference theme (ADR 0009) copies agent-site/ verbatim
// to its root; keeping the files generated here means the site can never advertise a stale
// skill list or a card that drifts from the server it describes.
//
// Usage:
//   node tools/agent-artifacts.mjs           # write agent-site/
//   node tools/agent-artifacts.mjs --check   # fail if agent-site/ differs from a fresh build
//
// Everything is derived from real inputs and nothing is invented:
// - index entries: name and description come from the SKILL.md frontmatter, the digest is
//   sha256 over the exact bytes of the SKILL.md, and the shape is what readability.agent-skills
//   validates (Agent Skills Discovery 0.2.0);
// - the card: serverInfo.name/version, description and transport come from packages/mcp/server.json;
//   the transport stays the stdio string the server actually connects — the server offers no hosted
//   endpoint (tools/server-json.test.mjs forbids claiming one), so the card claims none.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = "agent-site";
const SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The name and description from a SKILL.md frontmatter block; throws when either is missing. */
function frontmatter(text, file) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${file}: no frontmatter block`);
  const fields = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const field of ["name", "description"]) {
    if (!fields[field]) throw new Error(`${file}: frontmatter has no ${field}`);
  }
  return fields;
}

/** JSON with 2-space indent and a trailing newline, like every generated file here. */
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** The files agent-site/ must contain, as a map of repo-relative path to exact bytes. */
export function generateFiles() {
  const files = new Map();

  const skillsDir = join(root, "skills");
  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
  if (skills.length === 0) throw new Error("skills/: no skill folders with a SKILL.md");

  const entries = skills.map((folder) => {
    const source = join("skills", folder, "SKILL.md");
    const bytes = readFileSync(join(root, source));
    const fm = frontmatter(bytes.toString("utf8"), source);
    if (fm.name !== folder) throw new Error(`${source}: frontmatter name "${fm.name}" != folder "${folder}"`);
    if (!SKILL_NAME.test(fm.name) || fm.name.length > 64) throw new Error(`${source}: name "${fm.name}" fails the discovery spec's 1-64 lowercase/hyphen rule`);
    if (fm.description.length > 1024) throw new Error(`${source}: description is ${fm.description.length} characters; the limit is 1024`);
    const path = `.well-known/agent-skills/${fm.name}.md`;
    files.set(join(OUT_DIR, path), bytes);
    return {
      name: fm.name,
      type: "skill-md",
      description: fm.description,
      url: `/.well-known/agent-skills/${fm.name}.md`,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
  });
  files.set(join(OUT_DIR, ".well-known/agent-skills/index.json"), json({ $schema: SKILLS_SCHEMA, skills: entries }));

  const serverFile = join("packages/mcp", "server.json");
  const server = JSON.parse(readFileSync(join(root, serverFile), "utf8"));
  const npmEntry = server.packages[0];
  if (npmEntry.transport.type !== "stdio" || server.remotes !== undefined) {
    throw new Error(`${serverFile}: expected a stdio package with no hosted endpoint; fix the generator, not the card`);
  }
  files.set(
    join(OUT_DIR, ".well-known/mcp/server-card.json"),
    json({
      serverInfo: { name: server.name.split("/")[1], title: server.title, version: server.version },
      description: server.description,
      transport: npmEntry.transport.type,
    }),
  );

  return files;
}

const check = process.argv.includes("--check");
const files = generateFiles();
const mismatches = [];
if (!check) rmSync(join(root, OUT_DIR), { recursive: true, force: true });
for (const [path, content] of files) {
  const file = join(root, path);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (check) {
    if (!existsSync(file)) mismatches.push(`${path}: missing (run npm run agent:build)`);
    else if (!readFileSync(file).equals(bytes)) mismatches.push(`${path}: stale (run npm run agent:build)`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
}

if (check) {
  if (mismatches.length) {
    console.error(mismatches.map((m) => `agent-artifacts: ${m}`).join("\n"));
    process.exit(1);
  }
  console.log(`OK: agent artifacts (${files.size} published files in sync)`);
} else {
  console.log(`wrote ${files.size} files under ${OUT_DIR}/`);
}
