#!/usr/bin/env node
// Stdio launcher for the Seaworthy MCP server, started by the Claude Code plugin (see ../.mcp.json).
// It never writes to stdout itself: that pipe is the server's JSON-RPC channel. It finds a built
// server, spawns it with inherited stdio, and when nothing is found exits 1 with a fix hint on
// stderr. Pre-alpha honesty: @seaworthy/* is not on npm, so every path here is a local build.

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// bin/ sits in the plugin root; ../.. from there is the repository root when the plugin was
// installed from this repo (local marketplace or a git-reference checkout).
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function serverCandidates() {
  const candidates = [];
  if (process.env.SEAWORTHY_MCP_SERVER) candidates.push(resolve(process.env.SEAWORTHY_MCP_SERVER));
  // A built checkout of this repository.
  candidates.push(join(pluginRoot, "..", "..", "packages", "mcp", "dist", "src", "main.js"));
  return candidates;
}

const candidates = serverCandidates();
const server = candidates.find((candidate) => existsSync(candidate));
if (!server) {
  process.stderr.write(
    "seaworthy-mcp: no built MCP server found. Tried:\n" +
      candidates.map((candidate) => `  ${candidate}\n`).join("") +
      "Fix it with one of:\n" +
      "  - in a Seaworthy checkout: npm ci && npm run build\n" +
      "  - or point SEAWORTHY_MCP_SERVER at a built packages/mcp/dist/src/main.js\n",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [server], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
