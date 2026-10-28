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
export { buildMarkdownGraph, createSlugger, headingText, parseMarkdown, resolveTarget } from "./markdown.js";
export type { MdHeading, MdImage, MdLink, MarkdownFile, MarkdownGraph, Slugger } from "./markdown.js";
export { DEFAULT_FOLDERS, discoverFolder, rootLabel } from "./folders.js";
export { fingerprint, runChecks, validateCheckId } from "./engine.js";
export type { CheckTiming, RunOptions, RunResult } from "./engine.js";
export { buildReport, compareFindings, reportToJson } from "./report.js";
export type { ReportInput } from "./report.js";
export { FORMATS, formatReport } from "./formats/index.js";
export type { Format, FormatContext } from "./formats/index.js";
export { formatSarif, toSarif } from "./formats/sarif.js";
export type { SarifContext } from "./formats/sarif.js";
export { CONFIG_FILE, ConfigError, loadConfig, parseConfig, resolveChecks } from "./config.js";
export type { CheckSetting, Config, ConfigSuppression } from "./config.js";
export { applySuppressions, parseInlineSuppressions } from "./suppress.js";
export type { SuppressedFinding, Suppression } from "./suppress.js";
export { BaselineError, applyBaseline, createBaseline, readBaseline, writeBaseline } from "./baseline.js";
export type { Baseline, BaselineEntry } from "./baseline.js";
export { verifySite } from "./verify.js";
export type { StageTiming, Timings, VerifyOptions, VerifyResult } from "./verify.js";
export { builtInChecks } from "./checks/index.js";
export { VIEWPORTS, viewportLabel } from "./render.js";
export type { Viewport } from "./render.js";
export { SUPPRESSION_CHECKS } from "./suppress.js";
export { detectBasePath, resolveBasePath } from "./base-path.js";
export type { BasePathDetection, BasePathDetectionResult, BasePathFinding, BasePathGenerator, BasePathResolution, Canonical, UnclassifiedBasePath } from "./base-path.js";
export { CACHE_FILE, ChangedError, changedSinceLastRun, changedSinceRef } from "./changed.js";
export { formatDiffComment } from "./formats/markdown.js";
export { diffReports, diffToJson, readReport } from "./diff.js";
export type { DiffReport, ReportDiff } from "./diff.js";
export { WATCH_DEBOUNCE_MS, WatchLoop, WatchScheduler, watchDiffText, watchStatusText } from "./watch.js";
export type { WatchLoopOptions, WatchSchedulerOptions } from "./watch.js";
