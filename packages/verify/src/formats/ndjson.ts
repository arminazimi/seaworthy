// NDJSON: one finding per line, newline-delimited, for consumers that read results live.
//
// Every line is the finding exactly as the JSON report carries it: the same fields, the
// same order (checkId, severity, message, location, fix, fingerprint, evidence when the run
// saved a crop, prompt), compact, with no run state. Lines stream as each check finishes, so
// line order follows check completion and can vary between runs; each line alone is
// deterministic, and the set of lines is always the report's findings.

import type { Finding, Report } from "../types.js";
import type { Formatter } from "./base.js";

/** One line, ending in a newline: the finding, as JSON.stringify writes it. */
export function ndjsonLine(finding: Finding): string {
  return JSON.stringify(finding) + "\n";
}

/** The run's findings as NDJSON, in the report's (sorted) order. */
export function formatNdjson(report: Report): string {
  return report.findings.map(ndjsonLine).join("");
}

/** The registry's entry point: the same lines, in the report's (sorted) order. */
export const render: Formatter = (report) => formatNdjson(report);
