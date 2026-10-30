// Public entry point for @seaworthy/mcp: the MCP server, a thin adapter over the verify API.

export { DIFF_REPORTS_DESCRIPTION, DIFF_REPORTS_INPUT, DIFF_REPORTS_NAME, diffReportsJson } from "./diff-reports.js";
export type { DiffReportsInput, DiffReportsOptions } from "./diff-reports.js";
export {
  EXPLAIN_FINDING_DESCRIPTION,
  EXPLAIN_FINDING_INPUT,
  EXPLAIN_FINDING_NAME,
  explainFinding,
} from "./explain-finding.js";
export type { ExplainFindingInput, ExplainFindingOptions, ExplainFindingOutput, ExplainableFinding } from "./explain-finding.js";
export { LIST_CHECKS_DESCRIPTION, LIST_CHECKS_NAME, listChecks } from "./list-checks.js";
export type { ListChecksOutput, ListedCheck } from "./list-checks.js";
export type { ProgressReporter, ToolRequestExtra } from "./progress.js";
export { createProgressReporter, withProgress } from "./progress.js";
export { PLANNED_TOOLS } from "./planned.js";
export {
  ADOPT_EXISTING_SITE_ARGS,
  ADOPT_EXISTING_SITE_DESCRIPTION,
  ADOPT_EXISTING_SITE_NAME,
  FIX_EVERYTHING_ARGS,
  FIX_EVERYTHING_DESCRIPTION,
  FIX_EVERYTHING_NAME,
  MAKE_AGENT_READY_ARGS,
  MAKE_AGENT_READY_DESCRIPTION,
  MAKE_AGENT_READY_NAME,
  adoptExistingSitePrompt,
  fixEverythingPrompt,
  makeAgentReadyPrompt,
  registerPrompts,
} from "./prompts.js";
export type { FixEverythingInput, SitePromptInput } from "./prompts.js";
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
export { FIX_PREVIEW_DESCRIPTION, FIX_PREVIEW_INPUT, FIX_PREVIEW_NAME, fixPreviewReport } from "./fix-preview.js";
export type { FixPreviewInput, FixPreviewOptions, FixPreviewOutput, PreviewManual } from "./fix-preview.js";
