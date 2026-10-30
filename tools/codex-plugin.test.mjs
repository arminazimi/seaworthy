// Issue #258: the Codex bundle the repository carries. Codex has no plugin marketplace — it reads MCP
// servers from ~/.codex/config.toml and takes skills as plain files — so what is checkable offline is
// the honesty of the bundle: every path it names exists in this repository, every skill it names exists
// on disk with the exact SKILL.md name, it advertises only the tools the server really registers, and the
// install lines it publishes are runnable today (git reference or local build, never the npm registry:
// @seaworthy/* is not published and no tag exists). What needs a Codex account stays out (see the README).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = join(root, "plugins", "seaworthy-codex");

const BUNDLE_MANIFEST = "plugins/seaworthy-codex/bundle.json";
const CODEX_CONFIG = "plugins/seaworthy-codex/codex-config.toml";
const BUNDLE_README = "plugins/seaworthy-codex/README.md";
const CHECKOUT_PLACEHOLDER = "<checkout>/";

// packages/mcp/src/planned.ts: not implemented, so nothing the bundle ships may advertise them.
// `explain_finding` left that list when issue #78 shipped, so it is a real tool the bundle may name.
const PLANNED_TOOLS = ["get_config_schema", "create_baseline"];

const read = (relative) => readFileSync(join(root, relative), "utf8");
const bundle = JSON.parse(read(BUNDLE_MANIFEST));

/** Every file of the bundle, as text, for the "no false promise anywhere" sweep. */
function bundleFiles(dir = bundleDir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...bundleFiles(path));
    else found.push(path);
  }
  return found.sort();
}

/** A line makes an install claim only if it tells the reader to run something. */
function installClaims(text, { ignoreComments = false } = {}) {
  const lines = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (ignoreComments && line.startsWith("#")) continue;
    if (/\b(npx|npm install|npm i)\b/.test(line)) lines.push(line);
  }
  return lines;
}

/** The skill names a real skills/ tree would carry: folders holding a SKILL.md in this repository. */
function skillsOnDisk() {
  const skillsRoot = join(root, "skills");
  if (!existsSync(skillsRoot)) return [];
  const names = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsRoot, entry.name, "SKILL.md");
    if (existsSync(skillFile)) names.push({ dir: entry.name, frontMatterName: readFrontMatterName(skillFile) });
  }
  return names;
}

function readFrontMatterName(skillFile) {
  const text = readFileSync(skillFile, "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!match) return undefined;
  const name = /^name:\s*(.+?)\s*$/m.exec(match[1]);
  return name ? name[1].replace(/^["']|["']$/g, "") : undefined;
}

test("the bundle exists, parses, and carries metadata without inventing product facts", () => {
  for (const file of [BUNDLE_MANIFEST, CODEX_CONFIG, BUNDLE_README]) {
    assert.ok(existsSync(join(root, file)), `${file}: missing from the bundle`);
    assert.ok(read(file).trim().length > 0, `${file}: empty`);
  }
  assert.equal(bundle.name, "seaworthy-codex");
  assert.equal(bundle.host, "codex", "the bundle declares its host; it is not a Claude plugin");
  assert.equal(bundle.version, "0.0.0", "pre-alpha: @seaworthy/* is not published, do not claim a released version");
  assert.equal(bundle.license, "Apache-2.0");
  assert.equal(typeof bundle.description, "string");
  // Pasted-config bundle: the README must say Codex has no marketplace instead of pretending to one.
  assert.match(read(BUNDLE_README), /no plugin marketplace/i);
});

test("the MCP command and args resolve to a real launcher in this repository", () => {
  assert.equal(bundle.mcp.command, "node");
  assert.ok(Array.isArray(bundle.mcp.args) && bundle.mcp.args.length > 0);
  for (const arg of bundle.mcp.args) {
    assert.ok(arg.startsWith(CHECKOUT_PLACEHOLDER), `${arg}: args must be checkout-relative, got ${arg}`);
    const target = join(root, arg.slice(CHECKOUT_PLACEHOLDER.length));
    assert.ok(existsSync(target), `${arg}: launcher does not exist in the repository`);
  }
  // The launcher is shared with the Claude plugin (#87), not copied: one discovery logic, no drift.
  assert.ok(bundle.mcp.launcher.startsWith("plugins/seaworthy/"), "must reference the shared launcher, not a copy");
  assert.ok(existsSync(join(root, bundle.mcp.launcher)), `${bundle.mcp.launcher}: shared launcher missing`);
  assert.deepEqual(bundle.mcp.args, [`${CHECKOUT_PLACEHOLDER}${bundle.mcp.launcher}`], "config and manifest must name one launcher");
  // codex-config.toml is the snippet the user pastes: its section, command and args must match the manifest.
  const config = read(CODEX_CONFIG);
  assert.ok(config.includes(`[${bundle.mcp.configSection}]`), `config must define ${bundle.mcp.configSection}`);
  assert.match(config, /^command = "node"$/m);
  for (const arg of bundle.mcp.args) assert.ok(config.includes(`"${arg}"`), `config omits arg ${arg}`);
  assert.equal(bundle.mcp.serverName, "seaworthy");
  // The entry point the launcher spawns is a real source file, built to the path the manifest names.
  assert.ok(existsSync(join(root, "packages", "mcp", "src", "main.ts")), "packages/mcp/src/main.ts is the server source");
  assert.ok(bundle.mcp.serverEntry.startsWith("packages/mcp/dist/"), "the server entry is build output, never committed");
});

test("the bundle advertises exactly the tools the server registers", () => {
  const server = read(join("packages", "mcp", "src", "server.ts"));
  const registered = server.match(/server\.registerTool\(/g) ?? [];
  assert.equal(bundle.mcp.tools.length, registered.length, "bundle tool count must match packages/mcp/src/server.ts");
  for (const tool of bundle.mcp.tools) {
    assert.ok(server.includes(`${tool.toUpperCase()}_NAME`), `${tool}: not registered by the server source`);
    assert.ok(toolSource().includes(`"${tool}"`), `${tool}: the server never declares this tool name`);
  }
});

/** The whole MCP server source, so a bundled tool name is checked against a string the server sends. */
function toolSource() {
  return readdirSync(join(root, "packages", "mcp", "src"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => read(join("packages", "mcp", "src", file)))
    .join("");
}

test("every skill the bundle names exists on disk with the exact SKILL.md name", () => {
  const real = skillsOnDisk();
  // The bundle may not lead or lag the repository: an empty list is honest while #83 is open, a stale
  // one fails here.
  assert.deepEqual([...bundle.skills].sort(), real.map((skill) => skill.dir).sort(), "bundle.skills must be the skills/ tree, exactly");
  for (const name of bundle.skills) {
    const skill = real.find((candidate) => candidate.dir === name);
    assert.ok(skill, `skills/${name}/SKILL.md: named by the bundle but not on disk`);
    assert.equal(skill.frontMatterName, name, `skills/${name}/SKILL.md: front matter name must equal the bundled name`);
  }
  if (bundle.skills.length === 0) {
    assert.match(read(BUNDLE_README), /no `?SKILL\.md`? exists/i, "the README must state that no Skill exists yet");
  }
});

test("nothing the bundle ships advertises a planned tool or an npm-registry install", () => {
  for (const file of bundleFiles()) {
    const text = readFileSync(file, "utf8");
    const relative = file.slice(root.length + 1);
    const isMachineFile = !relative.endsWith(".md");
    for (const planned of PLANNED_TOOLS) {
      if (isMachineFile) {
        assert.equal(text.includes(planned), false, `${planned}: planned tool must not be advertised (${file})`);
        continue;
      }
      // Prose may name a planned tool only to say it does not exist, exactly as the plugin README does.
      for (const line of text.split("\n").filter((candidate) => candidate.includes(planned))) {
        assert.match(line, /planned|not implemented/i, `${relative}: ${planned} must be marked planned, never offered`);
      }
    }
    // @seaworthy/* is not on npm: no install line may resolve the server through a package registry,
    // and no version tag reference (#vN) may be published as installable.
    assert.equal(/#\s*v\d|@v\d/.test(text), false, `a tag reference is not an install path (${file})`);
    for (const line of installClaims(text, { ignoreComments: isMachineFile })) {
      assert.match(line, /github:arminazimi\/seaworthy#[0-9a-f]{40}/, `${relative}: install line is not a git reference: ${line}`);
    }
  }
});

test("the published install instructions are runnable today", () => {
  const readme = read(BUNDLE_README);
  assert.equal(bundle.install.registry, false);
  assert.match(bundle.install.commit, /^[0-9a-f]{40}$/, "pre-alpha installs pin a full commit SHA");
  assert.equal(bundle.install.gitReference, `github:arminazimi/seaworthy#${bundle.install.commit}`);
  assert.ok(readme.includes(bundle.install.commit), "the README names the commit it was written against");
  assert.ok(readme.includes("npm ci"), "the README must include the local build path");
  assert.ok(readme.includes("npm run build"), "the MCP server is TypeScript; the README must build it");
  // Codex does not expand variables in the args paths, so the snippet keeps an explicit placeholder.
  assert.ok(read(CODEX_CONFIG).includes(CHECKOUT_PLACEHOLDER.trim()));
});

test("the launcher the config points at completes the MCP initialize handshake", { skip: existsSync(join(root, bundle.mcp.serverEntry)) ? false : "built MCP server missing: run `npm run build` first" }, async () => {
  const launcher = join(root, bundle.mcp.launcher);
  const child = spawn(process.execPath, [launcher], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SEAWORTHY_MCP_SERVER: "" },
    cwd: root,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const killer = setTimeout(() => child.kill(), 10_000);
  try {
    const reply = await new Promise((resolve, reject) => {
      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        const line = buffer.split("\n").find((candidate) => candidate.trim().length > 0);
        if (line) resolve(JSON.parse(line));
      });
      child.once("exit", (code) => reject(new Error(`launcher exited ${code} before responding; stderr: ${stderr}`)));
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "node:test/codex-plugin", version: "0.0.0" } },
        }) + "\n",
      );
    });
    assert.equal(reply.id, 1);
    assert.equal(reply.result?.serverInfo?.name, bundle.mcp.serverName);
    child.stdin.end();
    assert.equal(await new Promise((resolve) => child.once("exit", resolve)), 0, `server did not exit cleanly; stderr: ${stderr}`);
  } finally {
    clearTimeout(killer);
    child.kill();
  }
});
