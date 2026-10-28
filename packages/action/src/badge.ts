// Badge endpoint for Seaworthy: a verify report in, badge SVG bytes out, for a workflow to commit
// and GitHub to serve (docs/badge.md). The state mapping and SVG construction live in
// tools/brand/badge.mjs (BRAND_GUIDE.md: one source for every badge); this is the thin adapter over
// it, loading it from the repository checkout. The report JSON is untrusted input: parsed, never
// evaluated.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Badge output: the state the SVG shows, the count behind it, and the SVG bytes. */
export interface Badge {
  state: "passing" | "warnings" | "failing";
  /** Findings or crashed checks that put the badge in this state; undefined while passing. */
  count?: number;
  /** Deterministic SVG bytes; one source: tools/brand/badge.mjs. */
  svg: string;
}

interface BadgeModule {
  badgeForReport(report: unknown): Badge;
  badgeSvg(state: "passing" | "warnings" | "failing", count?: number): string;
  README_SNIPPET: string;
}

// Resolve the repository root by walking up from this module until `tools/brand/badge.mjs` is
// there: dist/src/badge.js is four levels below it, src/badge.ts three.
function badgeSourceUrl(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, "tools", "brand", "badge.mjs");
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
    dir = dirname(dir);
  }
  throw new Error("badge: tools/brand/badge.mjs not found above the @seaworthy/action checkout");
}

/**
 * The badge module (tools/brand/badge.mjs), loaded from this checkout. The Action runs inside the
 * repository it verifies, so the checkout is always there; @seaworthy/action is not published.
 */
export async function badgeModule(): Promise<BadgeModule> {
  return (await import(badgeSourceUrl())) as BadgeModule;
}

/** The README snippet a consumer pastes verbatim to show the badge (see docs/badge.md). */
export async function readmeSnippet(): Promise<string> {
  return (await badgeModule()).README_SNIPPET;
}

/**
 * The badge for a Seaworthy report, the way `seaworthy verify --format json` writes it. Throws a
 * TypeError when the report does not carry the counts the badge reads; the message names the field.
 */
export async function badgeForReport(report: unknown): Promise<Badge> {
  return (await badgeModule()).badgeForReport(report);
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
