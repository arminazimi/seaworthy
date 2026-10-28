// Plain-text prompt export for the agent loop: one paste-able prompt that fixes
// every finding, worked through in order. Pure text, no color, no header, so the
// file an `--out` run writes is exactly what an agent pastes or reads.

import type { Report } from "../types.js";
import type { Formatter } from "./base.js";
import { groupedReportPrompt } from "../prompt.js";

export function formatPrompt(report: Report): string {
  return groupedReportPrompt(report.findings, report.root) + "\n";
}

export const render: Formatter = (report) => formatPrompt(report);
