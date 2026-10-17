import { reportToJson } from "../report.js";
import type { Report } from "../types.js";
import { formatMarkdown } from "./markdown.js";
import { formatPretty } from "./pretty.js";

export const FORMATS = ["pretty", "json", "markdown"] as const;
export type Format = (typeof FORMATS)[number];

export function formatReport(report: Report, format: Format): string {
  switch (format) {
    case "json":
      return reportToJson(report);
    case "markdown":
      return formatMarkdown(report);
    case "pretty":
      return formatPretty(report);
  }
}
