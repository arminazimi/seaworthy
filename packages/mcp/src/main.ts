#!/usr/bin/env node
// CLI entry point for the stdio MCP server (the `seaworthy-mcp` bin). An MCP client starts this
// process and speaks JSON-RPC on stdin/stdout; on stdin EOF the process exits on its own.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runStdio } from "./server.js";

// Run only when executed directly: as a bin or via `node dist/src/main.js`, not when imported.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) await runStdio();
