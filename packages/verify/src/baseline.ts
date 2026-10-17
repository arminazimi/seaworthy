// A baseline lets a site with many existing findings adopt Seaworthy today and fail only on new ones.
// It stores fingerprints with counts, so it survives edits that move a finding to another line.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { compareFindings } from "./report.js";
import type { Finding } from "./types.js";
import { REPORT_SPEC_VERSION } from "./version.js";

export interface BaselineEntry {
  checkId: string;
  file: string;
  fingerprint: string;
  /** How many findings with this fingerprint are accepted. */
  count: number;
}

export interface Baseline {
  spec: number;
  tool: "seaworthy";
  entries: BaselineEntry[];
}

export class BaselineError extends Error {}

export function createBaseline(findings: readonly Finding[]): Baseline {
  const entries = new Map<string, BaselineEntry>();
  for (const f of findings) {
    const entry = entries.get(f.fingerprint);
    if (entry) entry.count++;
    else entries.set(f.fingerprint, { checkId: f.checkId, file: f.location.file, fingerprint: f.fingerprint, count: 1 });
  }
  return {
    spec: REPORT_SPEC_VERSION,
    tool: "seaworthy",
    entries: [...entries.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.checkId < b.checkId ? -1 : a.checkId > b.checkId ? 1 : a.fingerprint < b.fingerprint ? -1 : 1)),
  };
}

export function writeBaseline(path: string, baseline: Baseline): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n");
}

export function readBaseline(path: string): Baseline {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new BaselineError(`cannot read baseline ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const b = raw as Partial<Baseline> | null;
  if (!b || b.tool !== "seaworthy" || !Array.isArray(b.entries)) throw new BaselineError(`${path} is not a Seaworthy baseline file`);
  if (b.spec !== REPORT_SPEC_VERSION) throw new BaselineError(`${path} was written for spec ${String(b.spec)}, but this version of Seaworthy uses spec ${REPORT_SPEC_VERSION}; run again with --update-baseline`);
  for (const e of b.entries) if (typeof e?.fingerprint !== "string" || !Number.isInteger(e.count) || e.count < 1) throw new BaselineError(`${path} has a malformed entry: ${JSON.stringify(e)}`);
  return b as Baseline;
}

export interface BaselineResult {
  /** Findings not covered by the baseline: the new ones. */
  findings: Finding[];
  baselined: number;
  /** Baseline entries (counted) that no longer match any finding: fixed problems. Prune with --update-baseline. */
  stale: number;
}

/** Removes findings the baseline accepts. For each fingerprint, up to `count` findings are accepted, in report order. */
export function applyBaseline(findings: readonly Finding[], baseline: Baseline): BaselineResult {
  const remaining = new Map(baseline.entries.map((e) => [e.fingerprint, e.count]));
  const kept: Finding[] = [];
  let baselined = 0;
  for (const finding of [...findings].sort(compareFindings)) {
    const left = remaining.get(finding.fingerprint) ?? 0;
    if (left > 0) {
      remaining.set(finding.fingerprint, left - 1);
      baselined++;
    } else kept.push(finding);
  }
  let stale = 0;
  for (const left of remaining.values()) stale += left;
  return { findings: kept, baselined, stale };
}
