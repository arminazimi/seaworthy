// The trend section of the PR comment (issue #375, `trends.pr-comment`).
//
// The numbers are Seaworthy's own: they come from the run summaries `verify` records in
// .seaworthy/history and are read with `readHistory` from @seaworthy/verify — nothing here
// re-counts findings or re-implements a check. This module only turns stored records into the
// few markdown lines the comment gains, which is why it lives beside `pr-comment.ts` instead
// of inside the engine.
//
// The rule for which runs are comparable, in one place:
//
//   1. A run is usable only when it carries a configuration hash, a count of findings, and an
//      ISO-8601 UTC start time; a record missing any of them is skipped, like the reader skips
//      a damaged file.
//   2. The newest usable run stands for the current run, and runs are grouped by ITS configHash:
//      a run recorded under another configuration measured something else, so it is dropped
//      rather than plotted next to its neighbours.
//   3. The TREND_RUNS most recent comparable runs are rendered, oldest first. Fewer than two of
//      them means no trend at all — one run has nothing to trend against, and a runner with no
//      history gets the comment it got before trends existed, byte for byte.

import { SEVERITIES, type HistoryRecord } from "@seaworthy/verify";

/** How many recent comparable runs the comment renders; the newest are kept, older ones dropped. */
export const TREND_RUNS = 10;

/** The line every comment body ends with; the trend sits above it so the marker still ends the body. */
export const COMMENT_MARKER = "<!-- seaworthy:pr-comment -->";

/** One stored run the comment can render. */
interface TrendRun {
  /** The hash that decides whether this run is comparable with the current one. */
  configHash: string;
  /** The UTC date part of the run's start time, as `2026-03-01`; never a local-time string. */
  date: string;
  findings: number;
  /** Findings per severity; a run that carries no count for one shows 0, not an invented blank. */
  counts: Record<(typeof SEVERITIES)[number], number>;
}

const ISO_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/;

/** The run as stored, or undefined when the record cannot be placed on a trend line. */
function asTrendRun(record: HistoryRecord): TrendRun | undefined {
  if (typeof record.configHash !== "string" || record.configHash === "") return undefined;
  const date = ISO_DATE_TIME.exec(record.started ?? "")?.[1];
  const findings = record.counts?.findings;
  if (date === undefined || typeof findings !== "number") return undefined;
  const bySeverity = record.counts?.bySeverity;
  const count = (severity: (typeof SEVERITIES)[number]): number => {
    const value = bySeverity?.[severity];
    return typeof value === "number" ? value : 0;
  };
  return { configHash: record.configHash, date, findings, counts: { error: count("error"), warning: count("warning"), note: count("note") } };
}

/**
 * The comparable runs, oldest first, at most TREND_RUNS of them: the newest usable record's
 * configHash decides which runs are comparable.
 */
export function comparableRuns(records: readonly HistoryRecord[]): TrendRun[] {
  const usable = records.map(asTrendRun).filter((run): run is TrendRun => run !== undefined);
  const current = usable[usable.length - 1];
  if (current === undefined) return [];
  return usable.filter((run) => run.configHash === current.configHash).slice(-TREND_RUNS);
}

/** The markdown lines of the trend, newest run last; empty when there is nothing to trend. */
export function trendLines(records: readonly HistoryRecord[]): string[] {
  const runs = comparableRuns(records);
  if (runs.length < 2) return [];
  const row = (run: TrendRun): string => `| ${run.date} | ${run.findings} | ${run.counts.error} | ${run.counts.warning} | ${run.counts.note} |`;
  return [
    `**Trend over the last ${runs.length} comparable runs (same configuration), oldest first**`,
    "",
    "| Date | Findings | Errors | Warnings | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...runs.map(row),
    "",
  ];
}

/**
 * The comment body with the trend placed above its closing marker. Returns `body` untouched when
 * the store holds no comparable runs, which is what keeps a single-run CI job's comment identical
 * to the one posted before trends existed.
 */
export function withTrend(body: string, records: readonly HistoryRecord[]): string {
  const lines = trendLines(records);
  if (lines.length === 0) return body;
  const section = lines.join("\n") + "\n";
  const marker = body.indexOf(COMMENT_MARKER);
  // The real body always ends in the marker, so the trend sits above it. Anything else keeps its
  // own ending and just gains the section, separated by one blank line.
  if (marker === -1) return `${body.replace(/\n+$/, "")}\n\n${section}`;
  return body.slice(0, marker) + section + body.slice(marker);
}
