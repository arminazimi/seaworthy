// The `list_checks` tool result: check metadata read from the public verify API.
// This package is a thin adapter over the verify API and must not own check logic (AGENTS.md):
// a client learns what checks exist and publishes nothing more than verify already promises.

import { REPORT_SPEC_VERSION } from "@seaworthy/verify";
import type { CheckMeta, Needs, Severity } from "@seaworthy/verify";

/** Tool name, as a client would call it. Part of the MCP surface; stable once released. */
export const LIST_CHECKS_NAME = "list_checks";

export const LIST_CHECKS_DESCRIPTION =
  "List the built-in Seaworthy checks with id, title, default severity, requirements, docs URL, and standards. Reads no site and produces no findings.";

/** Minified metadata for one check. Key order is fixed: additive only, like every Seaworthy contract. */
export interface ListedCheck {
  readonly id: string;
  readonly title: string;
  readonly severity: Severity;
  readonly needs: readonly Needs[];
  readonly docs: string;
  readonly standards: readonly string[];
}

/** What the tool emits. Field order is fixed; consumers parse, never stringify-compare. */
export interface ListChecksOutput {
  /** Version of the report contract these checks belong to (verify's REPORT_SPEC_VERSION). */
  readonly spec: number;
  /** Check metadata, sorted by check ID. */
  readonly checks: readonly ListedCheck[];
}

const byId = (a: ListedCheck, b: ListedCheck): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Serializes check metadata as deterministic JSON: fixed key order, checks sorted by ID. */
export function listChecks(checks: readonly CheckMeta[]): string {
  const output: ListChecksOutput = {
    spec: REPORT_SPEC_VERSION,
    checks: checks
      .map((meta): ListedCheck => ({ id: meta.id, title: meta.title, severity: meta.severity, needs: meta.needs, docs: meta.docs, standards: meta.standards }))
      .sort(byId),
  };
  return JSON.stringify(output);
}
