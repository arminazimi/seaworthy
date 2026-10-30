// Public entry point for @seaworthy/mcp: the MCP server, a thin adapter over the verify API.

export {
  EXPLAIN_FINDING_DESCRIPTION,
  EXPLAIN_FINDING_INPUT,
  EXPLAIN_FINDING_NAME,
  explainFinding,
} from "./explain-finding.js";
export type { ExplainFindingInput, ExplainFindingOptions, ExplainFindingOutput, ExplainableFinding } from "./explain-finding.js";
export { LIST_CHECKS_DESCRIPTION, LIST_CHECKS_NAME, listChecks } from "./list-checks.js";
export type { ListChecksOutput, ListedCheck } from "./list-checks.js";
export { PLANNED_TOOLS } from "./planned.js";
export { SERVER_NAME, SERVER_TITLE, createServer, runStdio } from "./server.js";
export { SERVER_VERSION } from "./version.js";
export type { SeaworthyMcpOptions } from "./server.js";
export {
  VERIFY_CHANGED_DESCRIPTION,
  VERIFY_CHANGED_INPUT,
  VERIFY_CHANGED_NAME,
  VERIFY_SITE_DESCRIPTION,
  VERIFY_SITE_INPUT,
  VERIFY_SITE_NAME,
  verifyChangedReport,
  verifySiteReport,
} from "./verify-tools.js";
export type { VerifyChangedInput, VerifySiteInput, VerifyToolOptions } from "./verify-tools.js";
