// Issue #87: the Claude Code plugin the repository carries. Everything here is checkable offline:
// the manifests are valid JSON with the fields Claude Code requires, every path they name exists
// in this repository, nothing advertises planned-but-unbuilt MCP tools or an unpinned npm install
// (@seaworthy/* is not published), and the bundled launcher either spawns the real server or exits
// with a fix hint. What needs a Claude Code account or the npm publish stays out (see the plugin README).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "plugins", "seaworthy");
const launcher = join(pluginDir, "bin", "seaworthy-mcp.mjs");
const builtServer = join(root, "packages", "mcp", "dist", "src", "main.js");

const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), "utf8"));

const MARKETPLACE = ".claude-plugin/marketplace.json";
const PLUGIN_MANIFEST = "plugins/seaworthy/.claude-plugin/plugin.json";
const MCP_CONFIG = "plugins/seaworthy/.mcp.json";

// Tools listed in packages/mcp/src/planned.ts: not implemented, so nothing the plugin ships may advertise them.
const PLANNED_TOOLS = ["explain_finding", "get_config_schema", "create_baseline"];

test("marketplace.json is a valid manifest whose plugin sources exist in the repo", () => {
  const marketplace = readJson(MARKETPLACE);
  assert.equal(typeof marketplace.name, "string");
  assert.ok(marketplace.name.length > 0);
  assert.equal(typeof marketplace.owner?.name, "string");
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0);
  for (const entry of marketplace.plugins) {
    assert.equal(typeof entry.name, "string");
    assert.equal(typeof entry.description, "string");
    // Reproducible from a git reference: local paths inside this repository only, never npm or tags.
    assert.equal(typeof entry.source, "string");
    assert.ok(entry.source.startsWith("./"), `${entry.name}: source must be a repo-local path, got ${entry.source}`);
    const sourceDir = join(root, entry.source);
    assert.ok(existsSync(sourceDir), `${entry.name}: source ${entry.source} does not exist`);
    const manifestPath = join(sourceDir, ".claude-plugin", "plugin.json");
    assert.ok(existsSync(manifestPath), `${entry.name}: no plugin manifest at ${entry.source}`);
    const plugin = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(plugin.name, entry.name, `${entry.name}: plugin.json name must match the marketplace entry`);
  }
});

test("the plugin manifest carries metadata without inventing product facts", () => {
  const plugin = readJson(PLUGIN_MANIFEST);
  assert.equal(plugin.name, "seaworthy");
  assert.equal(plugin.version, "0.0.0", "pre-alpha: @seaworthy/* is not published, do not claim a released version");
  assert.equal(plugin.license, "Apache-2.0");
  assert.equal(typeof plugin.description, "string");
});

test("nothing the plugin ships advertises planned-but-unbuilt tools or an unpublished npm install", () => {
  const texts = [MARKETPLACE, PLUGIN_MANIFEST, MCP_CONFIG].map((path) => JSON.stringify(readJson(path)));
  for (const text of texts) {
    for (const planned of PLANNED_TOOLS) {
      assert.equal(text.includes(planned), false, `planned tool ${planned} must not appear in a plugin manifest`);
    }
    // @seaworthy/* is not on npm: no manifest may resolve the server through a package registry.
    assert.equal(/npx|npm i|npm install/.test(text), false, "installs must be from a git reference or local build, never npm");
    // A "skills/" path in a manifest would be a promise of a component that does not exist yet.
    assert.equal(text.includes("skills/"), false, "the plugin bundles no skills until SKILL.md files exist");
  }
});

test(".mcp.json declares the seaworthy server and only paths that exist in the repo", () => {
  const config = readJson(MCP_CONFIG);
  assert.deepEqual(Object.keys(config.mcpServers), ["seaworthy"]);
  const server = config.mcpServers.seaworthy;
  assert.equal(server.command, "node");
  assert.ok(Array.isArray(server.args) && server.args.length > 0);
  for (const arg of server.args) {
    assert.ok(arg.startsWith("${CLAUDE_PLUGIN_ROOT}/"), `${arg}: server paths must be plugin-root-relative`);
    const target = join(pluginDir, arg.slice("${CLAUDE_PLUGIN_ROOT}/".length));
    assert.ok(existsSync(target), `${arg}: referenced file does not exist in the repository`);
  }
});

test("every skills directory the plugin bundles is a real skill", () => {
  // Trivially true while no SKILL.md exists upstream (#83 open); it pins the rule for later.
  const skillsDir = join(pluginDir, "skills");
  if (!existsSync(skillsDir)) return;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    assert.ok(entry.isDirectory(), `${entry.name}: skills/ holds only skill folders`);
    assert.ok(existsSync(join(skillsDir, entry.name, "SKILL.md")), `${entry.name}: every bundled skill needs a SKILL.md`);
  }
});

test("the launcher spawns the real server and completes the MCP initialize handshake", { skip: existsSync(builtServer) ? false : "built MCP server missing: run `npm run build` first" }, async () => {
  const child = spawn(process.execPath, [launcher], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SEAWORTHY_MCP_SERVER: "" },
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
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "node:test/claude-plugin", version: "0.0.0" } },
        }) + "\n",
      );
    });
    assert.equal(reply.id, 1);
    assert.equal(reply.result?.serverInfo?.name, "seaworthy");
    child.stdin.end();
    assert.equal(await new Promise((resolve) => child.once("exit", resolve)), 0, `server did not exit cleanly; stderr: ${stderr}`);
  } finally {
    clearTimeout(killer);
    child.kill();
  }
});

test("the launcher exits 1 with a fix hint when no built server exists, and never writes to stdout", async () => {
  // A copy under a fake root: neither $SEAWORTHY_MCP_SERVER nor the repo-relative candidate resolve.
  const fake = mkdtempSync(join(tmpdir(), "seaworthy-plugin-"));
  try {
    const fakeBin = join(fake, "plugins", "seaworthy", "bin");
    mkdirSync(fakeBin, { recursive: true });
    copyFileSync(launcher, join(fakeBin, "seaworthy-mcp.mjs"));
    const child = spawn(process.execPath, [join(fakeBin, "seaworthy-mcp.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SEAWORTHY_MCP_SERVER: join(fake, "missing-main.js") },
      cwd: fake,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 1);
    assert.equal(stdout, "", "stdout is the JSON-RPC channel; a failed launcher must leave it silent");
    assert.match(stderr, /npm run build/);
    assert.match(stderr, /SEAWORTHY_MCP_SERVER/);
    // The hint must name the paths it really tried, including the environment override.
    assert.match(stderr, /missing-main\.js/);
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});
