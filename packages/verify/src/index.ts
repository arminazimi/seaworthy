// Public entry point for @seaworthy/verify.

export { REPORT_SPEC_VERSION, VERSION } from "./version.js";

export type {
  Check,
  CheckContext,
  CheckError,
  CheckMeta,
  Edit,
  Finding,
  FindingDraft,
  Fix,
  Location,
  Needs,
  Report,
  ReportCheck,
  Severity,
  SkippedCheck,
} from "./types.js";
export { SEVERITIES } from "./types.js";
export { attr, buildSite, positionOf } from "./site.js";
export type { HtmlElement, LinkTarget, Page, SiteGraph } from "./site.js";
export { fingerprint, runChecks, validateCheckId } from "./engine.js";
export type { RunOptions, RunResult } from "./engine.js";
export { buildReport, compareFindings, reportToJson } from "./report.js";
export type { ReportInput } from "./report.js";
