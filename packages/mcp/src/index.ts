// Public entry point for @seaworthy/mcp: the MCP server, a thin adapter over the verify API.

export { LIST_CHECKS_DESCRIPTION, LIST_CHECKS_NAME, listChecks } from "./list-checks.js";
export type { ListChecksOutput, ListedCheck } from "./list-checks.js";
export { PLANNED_TOOLS } from "./planned.js";
export { SERVER_NAME, SERVER_TITLE, createServer, runStdio } from "./server.js";
export { SERVER_VERSION } from "./version.js";
export type { SeaworthyMcpOptions } from "./server.js";
