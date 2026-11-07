#!/usr/bin/env node
// CLI entry point for the MCP server (the `seaworthy-mcp` bin). An MCP client starts this
// process and speaks JSON-RPC on stdin/stdout; on stdin EOF the process exits on its own.
// With --http the same server is served over local Streamable HTTP instead (issue #254).

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MCP_HTTP_HELP, parseMcpArgs, runHttp } from "./http.js";
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

if (invokedDirectly()) {
  const invocation = parseMcpArgs(process.argv.slice(2));
  if (invocation.kind === "http") {
    await runHttp(invocation.options);
  } else if (invocation.kind === "help") {
    console.log(MCP_HTTP_HELP);
  } else if (invocation.kind === "usage") {
    console.error(`seaworthy-mcp: ${invocation.message}\n\n${MCP_HTTP_HELP}`);
    process.exitCode = 2;
  } else {
    // The default, unchanged by issue #254: stdio, exactly as before.
    await runStdio();
  }
}
