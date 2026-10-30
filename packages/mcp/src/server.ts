// The MCP server: a thin adapter over the verify API (AGENTS.md: `packages/mcp` must not own check logic).
// This is the skeleton (issue #76) plus the verify tools (issue #77): an initialize handshake over
// stdio, `list_checks` for the check metadata, and `verify_site` / `verify_changed` for the reports.
// Tools for later issues are listed in "./planned.js" and stay unregistered until they ship.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { builtInChecks } from "@seaworthy/verify";
import type { Check } from "@seaworthy/verify";
import { LIST_CHECKS_DESCRIPTION, LIST_CHECKS_NAME, listChecks } from "./list-checks.js";
import { withProgress } from "./progress.js";
import { SERVER_VERSION } from "./version.js";
import {
  VERIFY_CHANGED_DESCRIPTION,
  VERIFY_CHANGED_INPUT,
  VERIFY_CHANGED_NAME,
  VERIFY_SITE_DESCRIPTION,
  VERIFY_SITE_INPUT,
  VERIFY_SITE_NAME,
  verifyChangedReport,
  verifySiteReport,
} from "./verify-tools.js";

/** serverInfo.name reported in the initialize handshake. */
export const SERVER_NAME = "seaworthy";
/** serverInfo.title reported in the initialize handshake. */
export const SERVER_TITLE = "Seaworthy";

export interface SeaworthyMcpOptions {
  /** The checks the tools know about and run. Default: verify's built-in checks. */
  readonly checks?: readonly Check[];
  /** The workspace the site folder and the config resolve against. Default: process.cwd(). */
  readonly cwd?: string;
}

/**
 * Creates the Seaworthy MCP server with its tools registered, not yet connected.
 * Callers connect a transport, usually stdio (`runStdio`).
 */
export function createServer(options: SeaworthyMcpOptions = {}): McpServer {
  const checks: readonly Check[] = options.checks ?? builtInChecks;
  const toolOptions = { checks, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) };
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, title: SERVER_TITLE });
  server.registerTool(
    LIST_CHECKS_NAME,
    { description: LIST_CHECKS_DESCRIPTION },
    (): CallToolResult => ({ content: [{ type: "text", text: listChecks(checks.map((check) => check.meta)) }] }),
  );
  server.registerTool(
    VERIFY_SITE_NAME,
    { description: VERIFY_SITE_DESCRIPTION, inputSchema: VERIFY_SITE_INPUT },
    async (args, extra): Promise<CallToolResult> => ({ content: [{ type: "text", text: await verifySiteReport(args, withProgress(toolOptions, extra)) }] }),
  );
  server.registerTool(
    VERIFY_CHANGED_NAME,
    { description: VERIFY_CHANGED_DESCRIPTION, inputSchema: VERIFY_CHANGED_INPUT },
    async (args, extra): Promise<CallToolResult> => ({ content: [{ type: "text", text: await verifyChangedReport(args, withProgress(toolOptions, extra)) }] }),
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
