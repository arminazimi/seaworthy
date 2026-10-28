// `seaworthy diff before.json after.json`: what changed between two runs of the engine.
//
// Findings match by fingerprint — the same stable identity (check ID, file, key) the baseline
// uses — so the same problem is unchanged even when it moves to another line. Counts matter:
// three broken links before and two after means one fixed and two unchanged. Occurrences
// beyond the shared count, in `compareFindings` order, are the new and fixed ones.

import { readFileSync } from "node:fs";

import { compareFindings } from "./report.js";
import { SEVERITIES, type Finding } from "./types.js";
import { REPORT_SPEC_VERSION, VERSION } from "./version.js";

export class ReportDiffError extends Error {}

export interface DiffReport {
  root: string;
  findings: readonly Finding[];
}

/** A report JSON file as written by `verify --format json`. Paths are user input: parsed, never executed. */
export function readReport(path: string): DiffReport {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ReportDiffError(`cannot read report ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const r = raw as { spec?: unknown; tool?: { name?: unknown }; root?: unknown; findings?: unknown } | null;
  if (!r || r.tool?.name !== "seaworthy" || !Array.isArray(r.findings)) throw new ReportDiffError(`${path} is not a Seaworthy report file`);
  if (r.spec !== REPORT_SPEC_VERSION) throw new ReportDiffError(`${path} was written for spec ${String(r.spec)}, but this version of Seaworthy uses spec ${REPORT_SPEC_VERSION}`);
  if (typeof r.root !== "string") throw new ReportDiffError(`${path} names no site root`);
  const findings: Finding[] = [];
  for (const value of r.findings) {
    const f = value as Partial<Finding> | null;
    const ok = f !== null && typeof f === "object" && typeof f.checkId === "string" && typeof f.message === "string" && SEVERITIES.includes(f.severity as never) && typeof f.fingerprint === "string" && f.fingerprint !== "" && typeof f.location?.file === "string" && typeof f.fix === "object" && f.fix !== null;
    if (!ok) throw new ReportDiffError(`${path} has a malformed finding: ${JSON.stringify(value)}`);
    findings.push(f as Finding);
  }
  return { root: r.root, findings };
}

function bucket(findings: readonly Finding[]): Map<string, Finding[]> {
  const byKey = new Map<string, Finding[]>();
  for (const f of [...findings].sort(compareFindings)) {
    const list = byKey.get(f.fingerprint);
    if (list) list.push(f);
    else byKey.set(f.fingerprint, [f]);
  }
  return byKey;
}

export interface ReportDiff {
  spec: number;
  tool: { name: "seaworthy"; version: string };
  before: { root: string; findings: number };
  after: { root: string; findings: number };
  summary: { new: number; fixed: number; unchanged: number };
  new: readonly Finding[];
  fixed: readonly Finding[];
  unchanged: readonly Finding[];
}

/** Keys have a fixed order and every list is sorted, so two diffs of the same reports are byte-identical. */
export function diffReports(before: DiffReport, after: DiffReport): ReportDiff {
  const beforeByKey = bucket(before.findings);
  const afterByKey = bucket(after.findings);
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  const added: Finding[] = [];
  const removed: Finding[] = [];
  const shared: Finding[] = [];
  for (const key of keys) {
    const previous = beforeByKey.get(key) ?? [];
    const current = afterByKey.get(key) ?? [];
    const count = Math.min(previous.length, current.length);
    // Unchanged: the first occurrences in `compareFindings` order; the ones beyond it moved.
    shared.push(...current.slice(0, count));
    if (current.length > count) added.push(...current.slice(count));
    if (previous.length > count) removed.push(...previous.slice(count));
  }
  const sort = (findings: Finding[]): Finding[] => [...findings].sort(compareFindings); // each bucket is already sorted; this keeps the whole group ordered
  const fixed = sort(removed);
  return {
    spec: REPORT_SPEC_VERSION,
    tool: { name: "seaworthy", version: VERSION },
    before: { root: before.root, findings: before.findings.length },
    after: { root: after.root, findings: after.findings.length },
    summary: { new: added.length, fixed: fixed.length, unchanged: shared.length },
    new: sort(added),
    fixed,
    unchanged: sort(shared),
  };
}

/** Stable JSON text of a diff, ending in a newline: a new additive shape next to the report. */
export function diffToJson(diff: ReportDiff): string {
  return JSON.stringify(diff, null, 2) + "\n";
}
