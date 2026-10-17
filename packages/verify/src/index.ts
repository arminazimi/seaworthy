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
export { FORMATS, formatReport } from "./formats/index.js";
export type { Format, FormatContext } from "./formats/index.js";
export { formatSarif, toSarif } from "./formats/sarif.js";
export { CONFIG_FILE, ConfigError, loadConfig, parseConfig, resolveChecks } from "./config.js";
export type { CheckSetting, Config, ConfigSuppression } from "./config.js";
export { applySuppressions, parseInlineSuppressions } from "./suppress.js";
export type { SuppressedFinding, Suppression } from "./suppress.js";
export { BaselineError, applyBaseline, createBaseline, readBaseline, writeBaseline } from "./baseline.js";
export type { Baseline, BaselineEntry } from "./baseline.js";
export { verifySite } from "./verify.js";
export type { VerifyOptions, VerifyResult } from "./verify.js";
export { builtInChecks } from "./checks/index.js";
export { SUPPRESSION_CHECKS } from "./suppress.js";
export { CACHE_FILE, ChangedError, changedSinceLastRun, changedSinceRef } from "./changed.js";
