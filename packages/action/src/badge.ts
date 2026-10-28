// Badge endpoint for Seaworthy: a verify report in, badge SVG bytes out, for a workflow to commit
// and GitHub to serve (docs/badge.md). The state mapping and the SVG bytes are the pure module at
// badge-svg.ts, self-contained in @seaworthy/action; this is the thin CLI-facing adapter over them.
// The report JSON is untrusted input: parsed, never evaluated.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { README_SNIPPET } from "./badge-svg.js";

export { badgeForReport, badgeSvg, README_SNIPPET, STATUS, type Badge, type BadgeState } from "./badge-svg.js";

/** The README snippet a consumer pastes verbatim to show the badge (see docs/badge.md). */
export function readmeSnippet(): string {
  return README_SNIPPET;
}

/**
 * Writes the badge SVG to `out`, creating parent folders. Repeating a run keeps the file's bytes
 * identical, and nothing changes when the same SVG is already there (idempotent reruns in CI).
 */
export async function writeBadgeFile(svg: string, out: string): Promise<string> {
  await mkdir(dirname(out), { recursive: true });
  try {
    if ((await readFile(out, "utf8")) === svg) return out;
  } catch {
    // No file there yet: write it.
  }
  await writeFile(out, svg, "utf8");
  return out;
}
