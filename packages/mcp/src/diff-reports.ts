// The `diff_reports` tool: what is new and what was fixed between two recorded runs.
// This package is a thin adapter over the verify API (AGENTS.md): the comparison is verify's own
// `seaworthy diff` engine (packages/verify/src/diff.ts — fingerprint matching, the same identity
// the baseline uses), not a second matching rule living here.

import { resolve } from "node:path";

import { z } from "zod";

import { diffReports, diffToJson, readReport } from "@seaworthy/verify";

/** Tool name, as a client would call it. Part of the MCP surface; stable once released. */
export const DIFF_REPORTS_NAME = "diff_reports";

export const DIFF_REPORTS_DESCRIPTION =
  "Compare two stored Seaworthy reports and return what is new, what was fixed, and what is unchanged, as the same JSON `seaworthy diff before.json after.json` prints. The inputs are two report files written by `seaworthy verify --format json`, relative to the workspace; the tool reads and parses them — it never runs a verification, touches the network, or executes site code. Findings match by fingerprint, the same identity the baseline uses, so a problem that only moved lines stays unchanged.";

/** The input schema of `diff_reports`. */
export const DIFF_REPORTS_INPUT = {
  before: z
    .string()
    .describe("The earlier report file, relative to the workspace; as written by `seaworthy verify --format json`."),
  after: z
    .string()
    .describe("The newer report file, relative to the workspace; as written by `seaworthy verify --format json`."),
};

/** The inputs of `diff_reports`. */
export interface DiffReportsInput {
  readonly before: string;
  readonly after: string;
}

export interface DiffReportsOptions {
  /** The workspace the report paths resolve against. Default: process.cwd(). */
  readonly cwd?: string;
}

/**
 * The diff JSON of two stored reports: verify's `readReport` parses each file (untrusted input —
 * parsed, never executed) and `diffReports` + `diffToJson` produce the byte-stable shape, so two
 * calls with the same files return the same text on every platform.
 */
export function diffReportsJson(input: DiffReportsInput, options: DiffReportsOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  return diffToJson(diffReports(readReport(resolve(cwd, input.before)), readReport(resolve(cwd, input.after))));
}
