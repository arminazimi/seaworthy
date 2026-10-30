// Guards agent-site/ — the well-known agent files Seaworthy's own site publishes (issue #286).
//
// Two promises, both offline:
// 1. the committed files equal a fresh generation from skills/ and packages/mcp/server.json,
//    byte for byte, with no extras (the --check gate in npm run check runs the same comparison);
// 2. the published files pass Seaworthy's own agent-readability checks — the real
//    readability.agent-skills and readability.mcpCard checks from packages/verify read
//    agent-site/ as a built site and must report nothing.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildSite } from "../packages/verify/dist/src/site.js";
import { runChecks } from "../packages/verify/dist/src/engine.js";
import { readabilityAgentSkills, readabilityMcpCard } from "../packages/verify/dist/src/checks/readability.js";
import { generateFiles } from "./agent-artifacts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name).slice(root.length + 1)],
  );

test("the committed agent-site/ equals a fresh generation, byte for byte, with no extras", () => {
  const generated = generateFiles();
  const onDisk = walk(join(root, "agent-site"));
  assert.deepEqual(onDisk.slice().sort(), [...generated.keys()].sort(), "agent-site/ has files the generator does not write, or is missing some");
  for (const [path, content] of generated) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    assert.ok(readFileSync(join(root, path)).equals(bytes), `${path}: stale; run npm run agent:build`);
  }
});

test("agent-site/ passes Seaworthy's own agent-readability checks", async () => {
  const result = await runChecks({ site: buildSite(join(root, "agent-site")), checks: [readabilityAgentSkills, readabilityMcpCard] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings, [], "the published index and card must pass the checks we run on everyone else's site");
});

test("the skills index mirrors the skills folder: every skill, real digests", () => {
  const index = JSON.parse(readFileSync(join(root, "agent-site/.well-known/agent-skills/index.json"), "utf8"));
  const skillDirs = readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && readdirSync(join(root, "skills", d.name)).includes("SKILL.md"))
    .map((d) => d.name)
    .sort();
  assert.deepEqual(index.skills.map((s) => s.name), skillDirs);
  for (const skill of index.skills) {
    const source = readFileSync(join(root, "skills", skill.name, "SKILL.md"));
    assert.equal(skill.digest, `sha256:${createHash("sha256").update(source).digest("hex")}`);
    assert.equal(skill.type, "skill-md");
    const published = readFileSync(join(root, "agent-site", skill.url.slice(1)));
    assert.ok(published.equals(source), `${skill.url} must be the SKILL.md verbatim`);
  }
});

test("the MCP card mirrors server.json and claims no hosted endpoint", () => {
  const server = JSON.parse(readFileSync(join(root, "packages/mcp/server.json"), "utf8"));
  const card = JSON.parse(readFileSync(join(root, "agent-site/.well-known/mcp/server-card.json"), "utf8"));
  assert.equal(card.serverInfo.name, server.name.split("/")[1]);
  assert.equal(card.serverInfo.title, server.title);
  assert.equal(card.serverInfo.version, server.version);
  assert.equal(card.description, server.description);
  assert.equal(card.transport, server.packages[0].transport.type);
});
