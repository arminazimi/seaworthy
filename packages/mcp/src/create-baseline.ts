// The `create_baseline` tool: record the site's current findings as a baseline, the same
// document `seaworthy verify --update-baseline` writes. This package is a thin adapter over
// the verify API (AGENTS.md): the folder resolution, the run, and the baseline itself all go
// through verify's own functions — fingerprints with counts, never line numbers — and the file
// is written by verify's own writer. Seaworthy reports and suggests; the baseline is one of
// the few files it is allowed to create, and it creates it only where the caller pointed it,
// never inside the site.

import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { z } from "zod";

import {
  BASELINE_FILE,
  buildSite,
  builtInChecks,
  createBaseline,
  DEFAULT_FOLDERS,
  discoverFolder,
  loadConfig,
  resolveBasePath,
  rootLabel,
  verifySite,
  writeBaseline,
} from "@seaworthy/verify";
import type { Baseline, Check } from "@seaworthy/verify";

/** Tool name, as a client would call it. Part of the MCP surface; stable once released. */
export const CREATE_BASELINE_NAME = "create_baseline";

export const CREATE_BASELINE_DESCRIPTION =
  "Verify a built static site and record every current finding as a Seaworthy baseline: fingerprints with counts, so it survives edits that move a finding to another line. This is exactly what `seaworthy verify --update-baseline` writes. With a `path` the file is written there (relative to the workspace) — Seaworthy creates or replaces that one file and never touches the site. Without `path` nothing is written: the result carries the baseline document and the path it would go to (the config's baseline, else seaworthy-baseline.json).";

/** The input schema of `create_baseline`. */
export const CREATE_BASELINE_INPUT = {
  site: z
    .string()
    .optional()
    .describe("The built site folder, relative to the workspace. Default: the first of dist, build, out, public, _site, site that exists."),
  path: z
    .string()
    .optional()
    .describe("The baseline file to write, relative to the workspace. Absent: nothing is written; the result says where the file would go."),
};

/** The inputs of `create_baseline`. */
export interface CreateBaselineInput {
  readonly site?: string | undefined;
  readonly path?: string | undefined;
}

export interface CreateBaselineOptions {
  /** The workspace the site folder, the config, and the target path resolve against. Default: process.cwd(). */
  readonly cwd?: string;
  /** The checks to run. Default: verify's built-in checks. */
  readonly checks?: readonly Check[];
}

/**
 * What the tool emits. Field order is fixed; consumers parse, never stringify-compare. The
 * baseline itself is verify's own document (`spec: 0`, entries sorted by file, check ID,
 * fingerprint) and carries no timestamps.
 */
export interface CreateBaselineOutput {
  /** Whether the file was written this call; true only when the caller named a `path`. */
  readonly written: boolean;
  /** The target file, shown relative to the workspace when it is inside it. */
  readonly path: string;
  /** Findings the run produced; every one is recorded, as `--update-baseline` does. */
  readonly findings: number;
  /** Baseline entries after deduplicating identical fingerprints into counts. */
  readonly entries: number;
  /** The baseline document, the same one verify's reader accepts. */
  readonly baseline: Baseline;
}

/**
 * Runs one verification exactly like `seaworthy verify --update-baseline` does — the config's
 * root, base path, and rendered/network settings decide the run — records `unbaselined` with
 * verify's own `createBaseline`, and writes with verify's own `writeBaseline` only when the
 * caller named a path. Without a path the suggested target is the same file the CLI and init
 * treat as the baseline location: the config's `baseline`, else `seaworthy-baseline.json`.
 */
export async function createBaselineReport(input: CreateBaselineInput, options: CreateBaselineOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const checks = options.checks ?? builtInChecks;
  const { config } = loadConfig(cwd, undefined, checks.map((check) => check.meta.id));

  const requested = input.site ?? config.root ?? discoverFolder(cwd);
  if (requested === undefined) throw new Error(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder)) throw new Error(`no folder ${requested}; pass the folder your build writes to, or build first`);
  if (!statSync(folder).isDirectory()) throw new Error(`${requested} is not a folder; pass the folder your build writes to`);

  if (input.path !== undefined && input.path.trim() === "") throw new Error("path must name a file; pass a path like seaworthy-baseline.json, or no path at all to record without writing");

  const label = rootLabel(cwd, folder);
  const base = resolveBasePath({
    folder,
    ...(config.basePath === undefined ? {} : { configBasePath: config.basePath }),
  });
  const site = buildSite(folder, base.basePath === "/" ? {} : { basePath: base.basePath });

  const { unbaselined } = await verifySite({
    folder,
    site,
    rootLabel: label,
    checks,
    config,
    rendered: config.rendered === true,
    network: config.network === true,
  });
  const baseline = createBaseline(unbaselined);

  const writing = input.path !== undefined;
  const target = resolve(cwd, input.path ?? config.baseline ?? BASELINE_FILE);
  if (writing) writeBaseline(target, baseline);

  // Machine output is platform-neutral: a target inside the workspace is shown workspace-
  // relative with forward slashes, the way report findings are located; outside it stays absolute.
  const rel = relative(cwd, target);
  const display = rel === "" || rel.startsWith("..") || rel.includes(":") ? target.split("\\").join("/") : rel.split("\\").join("/");
  const output: CreateBaselineOutput = { written: writing, path: display, findings: unbaselined.length, entries: baseline.entries.length, baseline };
  return JSON.stringify(output);
}
