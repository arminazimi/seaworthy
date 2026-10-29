// Run history: after a verify run, one summary record lands in .seaworthy/history so the next
// run — or a tool, or an agent — can diff two runs and read trends over time.
//
// The store stays bounded: the most recent HISTORY_KEEP records are kept, the rest are pruned,
// oldest first. Every record is one file with sorted keys and stable ordering, so a plain text
// diff between two runs is meaningful. The store is read with the file name alone, so a partial
// write (a crash mid-write leaves a .tmp behind) damages at most that one record and never the
// next run.
//
// This writes a new file by default, which the roadmap asks for explicitly. Opt out with
// "history": false in seaworthy.config.json or --no-history; CI output is unchanged either way.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SEVERITIES, type Report, type Severity } from "./types.js";

/** Where history records live, relative to where verify runs (next to cache.json). */
export const HISTORY_DIR = join(".seaworthy", "history");

/** How many recent runs are kept, oldest pruned first. Bounded on purpose: history writes never grow without limit. */
export const HISTORY_KEEP = 30;

/** History spec 0 is the first published shape of the record; it freezes with the report format. */
export const HISTORY_SPEC_VERSION = 1;

const STORE_FILE = /^\d{4,}-\d{8}T\d{9}Z\.json$/;

export interface HistoryCounts {
  findings: number;
  bySeverity: Partial<Record<Severity, number>>;
  byCheck: Record<string, number>;
  suppressed: number;
  baselined: number;
  baselineStale: number;
  /** Present under --changed: findings were limited to this many files that changed. */
  changedFiles?: number;
  /** Checks that crashed; the report itself names them. */
  errors: number;
}

export interface HistoryRecord {
  spec: number;
  tool: "seaworthy";
  /** When the run started, ISO 8601 UTC. */
  started: string;
  /** The folder that was verified, as the user gave it (relative). */
  root: string;
  pages: number;
  /** sha256 of the effective run settings, so a trend can be grouped by configuration. */
  configHash: string;
  counts: HistoryCounts;
}

/** JSON with every object's keys sorted, ending in a newline, identical on every platform. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value), null, 2) + "\n";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = stableValue((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}

/**
 * A stable hash of the run's settings: the loaded config plus the flags that decided what ran
 * and what failed. Compare hashes, not settings, to see whether two runs are comparable.
 */
export function runConfigHash(settings: unknown): string {
  return createHash("sha256").update(stableStringify(settings)).digest("hex");
}

export interface HistoryRun {
  started: string;
  configHash: string;
}

/** Builds the record for one run out of its report. Counts name only what is nonzero, sorted. */
export function buildHistoryRecord(report: Report, run: HistoryRun): HistoryRecord {
  const byCheck: Record<string, number> = {};
  for (const finding of report.findings) byCheck[finding.checkId] = (byCheck[finding.checkId] ?? 0) + 1;
  const bySeverity: Partial<Record<Severity, number>> = {};
  for (const severity of SEVERITIES) {
    const count = report.findings.filter((f) => f.severity === severity).length;
    if (count > 0) bySeverity[severity] = count;
  }
  return {
    spec: HISTORY_SPEC_VERSION,
    tool: "seaworthy",
    started: run.started,
    root: report.root,
    pages: report.summary.pages,
    configHash: run.configHash,
    counts: {
      findings: report.findings.length,
      bySeverity,
      byCheck,
      suppressed: report.summary.suppressed,
      baselined: report.summary.baselined,
      baselineStale: report.summary.baselineStale,
      ...(report.summary.changedFiles === undefined ? {} : { changedFiles: report.summary.changedFiles }),
      errors: report.errors.length,
    },
  };
}

/** The store's own files, oldest first. Anything else in the folder is left alone. */
function storeFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => STORE_FILE.test(name)).sort((a, b) => seqNumber(a) - seqNumber(b));
}

const seqNumber = (name: string): number => Number.parseInt(name, 10);

/**
 * Reads the store back, oldest run first — the order `appendHistory` named the files in.
 * The reader never writes: a missing store is simply no runs, and a record that cannot be
 * read, parsed, or recognised (a truncated write, a hand-edited file) is skipped like the
 * writer skips the leftovers of a crashed run — one damaged file damages only itself, and
 * the next verify run prunes it in turn. Only the fields the readers of a trend need are
 * checked, so a record from an older or newer spec still loads when it is understandable.
 */
export function readHistory(cwd: string): HistoryRecord[] {
  const dir = join(cwd, HISTORY_DIR);
  const records: HistoryRecord[] = [];
  for (const name of storeFiles(dir)) {
    let text: string;
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch {
      continue;
    }
    const record = parseRecord(text);
    if (record !== undefined) records.push(record);
  }
  return records;
}

/** A stored record, or undefined for a file that is not one (corrupt, truncated, or foreign). */
function parseRecord(text: string): HistoryRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Partial<HistoryRecord>;
  if (typeof record.started !== "string" || typeof record.root !== "string") return undefined;
  const counts = record.counts;
  if (counts === null || typeof counts !== "object" || typeof counts.findings !== "number") return undefined;
  return record as HistoryRecord;
}

/**
 * Writes one record as `<seq>-<timestamp>.json` (run 1, 2, 3 … newest last) and prunes the oldest
 * beyond `keep`. Returns the path written. The record is written to a `.tmp` file first and then
 * renamed, so a crash mid-write never leaves a half-written record in the store.
 */
export function appendHistory(cwd: string, record: HistoryRecord, keep: number = HISTORY_KEEP): string {
  const dir = join(cwd, HISTORY_DIR);
  mkdirSync(dir, { recursive: true });
  // `0001-20260318T101500123Z.json`: the number orders the runs, the timestamp explains them.
  const stamp = record.started.replace(/[-:]/g, "").replace(".", "");
  const existing = storeFiles(dir);
  let seq = existing.length > 0 ? seqNumber(existing[existing.length - 1]!) : 0;
  let name = `${String(seq + 1).padStart(4, "0")}-${stamp}.json`;
  while (existsSync(join(dir, name))) name = `${String(++seq + 1).padStart(4, "0")}-${stamp}.json`;
  const target = join(dir, name);
  const temp = join(dir, `.${name}.tmp`);
  writeFileSync(temp, stableStringify(record));
  renameSync(temp, target);
  const prunable = storeFiles(dir);
  for (const oldest of prunable.slice(0, Math.max(0, prunable.length - keep))) {
    try {
      rmSync(join(dir, oldest));
    } catch {
      // Unreadable or taken: try again on the next run.
    }
  }
  return target;
}
