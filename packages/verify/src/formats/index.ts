import { PLAIN, type Palette } from "../color.js";
import { reportToJson } from "../report.js";
import type { Report } from "../types.js";
import { formatLlm } from "./llm.js";
import { formatMarkdown } from "./markdown.js";
import { formatPretty } from "./pretty.js";
import { formatPrompt } from "./prompt.js";
import { type SarifContext, formatSarif } from "./sarif.js";

export const FORMATS = ["pretty", "json", "markdown", "sarif", "llm", "prompt"] as const;
export type Format = (typeof FORMATS)[number];

export type FormatContext = SarifContext;

export function formatReport(report: Report, format: Format, context: FormatContext = {}, paint: Palette = PLAIN): string {
  switch (format) {
    case "json":
      return reportToJson(report);
    case "markdown":
      return formatMarkdown(report);
    case "pretty":
      return formatPretty(report, paint);
    case "prompt":
      return formatPrompt(report);
    case "sarif":
      return formatSarif(report, context);
    case "llm":
      return formatLlm(report);
  }
}
