// The MCP server: a thin adapter over the verify API (AGENTS.md: `packages/mcp` must not own check logic).
// This is the skeleton (issue #76): an initialize handshake over stdio plus the one tool the
// verify API already supports without inventing behavior — `list_checks`, check metadata only.
// Tools for later issues (#77+) are listed in "./planned.js" and stay unregistered until they ship.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { builtInChecks } from "@seaworthy/verify";
import type { CheckMeta } from "@seaworthy/verify";
import { LIST_CHECKS_DESCRIPTION, LIST_CHECKS_NAME, listChecks } from "./list-checks.js";
import { SERVER_VERSION } from "./version.js";

/** serverInfo.name reported in the initialize handshake. */
export const SERVER_NAME = "seaworthy";
/** serverInfo.title reported in the initialize handshake. */
export const SERVER_TITLE = "Seaworthy";

export interface SeaworthyMcpOptions {
  /** Check metadata exposed through `list_checks`. Defaults to verify's built-in checks. */
  readonly checks?: readonly CheckMeta[];
}

/**
 * Creates the Seaworthy MCP server with its tools registered, not yet connected.
 * Callers connect a transport, usually stdio (`runStdio`).
 */
export function createServer(options: SeaworthyMcpOptions = {}): McpServer {
  const checks: readonly CheckMeta[] = options.checks ?? builtInChecks.map((check) => check.meta);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, title: SERVER_TITLE });
  server.registerTool(
    LIST_CHECKS_NAME,
    { description: LIST_CHECKS_DESCRIPTION },
    (): CallToolResult => ({ content: [{ type: "text", text: listChecks(checks) }] }),
  );
  return server;
}

/**
 * Runs the server over stdio: an MCP client this process was spawned with speaks JSON-RPC on
 * stdin/stdout. Nothing else is ever written to stdout; when the client closes stdin the
 * process ends.
 */
export async function runStdio(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
