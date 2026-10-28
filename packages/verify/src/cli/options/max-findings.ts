// --max-findings: the cap on how many findings the report holds.

import { DEFAULT_MAX_FINDINGS } from "../../report.js";
import { UsageError } from "../types.js";
import type { Options } from "./index.js";
import { value } from "./value.js";

export interface MaxFindingsOptions {
  maxFindings: number | undefined;
}

export const MAX_FINDINGS_DEFAULTS: MaxFindingsOptions = { maxFindings: undefined };

export const MAX_FINDINGS_FLAGS: readonly string[] = ["--max-findings"];

export const MAX_FINDINGS_HELP = `  --max-findings <n>   Cap the report at n findings, in report order; the rest are omitted and counted
                       in the report as findingsOmitted. Default: ${DEFAULT_MAX_FINDINGS}. Caps never
                       change the exit code; it is decided from all findings, cut or not
`;

export function parseMaxFindings(options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number): number {
  const [v, next] = value(flag, inline, args, index);
  const n = /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--max-findings must be a whole number of at least 1, got "${v}"`);
  options.maxFindings = n;
  return next;
}
