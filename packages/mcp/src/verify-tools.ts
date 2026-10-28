// The `verify_site` and `verify_changed` tools: verify a built site and return the report JSON.
// This package is a thin adapter over the verify API (AGENTS.md): the tools call `verifySite`
// and hand back what it returns. No check logic, no rules, and no diffing live here.

import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { z } from "zod";

import {
  buildSite,
  builtInChecks,
  changedSinceLastRun,
  changedSinceRef,
  DEFAULT_FOLDERS,
  discoverFolder,
  loadConfig,
  reportToJson,
  resolveBasePath,
  rootLabel,
  verifySite,
} from "@seaworthy/verify";
import type { Check } from "@seaworthy/verify";

/** Tool name, as a client would call it. Part of the MCP surface; stable once released. */
export const VERIFY_SITE_NAME = "verify_site";
export const VERIFY_CHANGED_NAME = "verify_changed";

export const VERIFY_SITE_DESCRIPTION =
  "Verify a built static site and return the report JSON, the same JSON `seaworthy verify --format json` writes. Every finding names its check, its location, and a fix hint. The site folder defaults to the first of dist, build, out, public, _site, site that exists.";

export const VERIFY_CHANGED_DESCRIPTION =
  "Verify a built static site and report only the findings in the files that changed, like `--changed` and `--changed-since`. Returns the same report JSON as `verify_site`, with the findings outside the changed files left out. Without a `since` ref the files that changed since the last run are used, and the run records the current state in `.seaworthy/cache.json`.";

/** The inputs both tools share. */
const shared = {
  site: z
    .string()
    .optional()
    .describe("The built site folder, relative to the workspace. Default: the first of dist, build, out, public, _site, site that exists."),
  base: z
    .string()
    .optional()
    .describe('The base path the site is deployed under, such as "/repo/". Default: the config\'s basePath, else what a known generator config says, else "/".'),
  rendered: z
    .boolean()
    .optional()
    .describe("Run the checks that render pages in a browser. Opt-in: needs a browser installed on this machine."),
  network: z.boolean().optional().describe("Let the checks that need it reach the network. Opt-in: every other check stays offline."),
};

/** The input schema of `verify_site`. */
export const VERIFY_SITE_INPUT = { ...shared };

/** The input schema of `verify_changed`. */
export const VERIFY_CHANGED_INPUT = {
  ...shared,
  since: z
    .string()
    .optional()
    .describe("A git ref (branch, tag, or commit) to compare the site with. Default: the files that changed since the last run."),
};

export interface VerifyToolOptions {
  /** The workspace the site folder and the config resolve against. Default: process.cwd(). */
  readonly cwd?: string;
  /** The checks to run. Default: verify's built-in checks. */
  readonly checks?: readonly Check[];
}

/** The inputs of `verify_site`. */
export interface VerifySiteInput {
  readonly site?: string | undefined;
  readonly base?: string | undefined;
  readonly rendered?: boolean | undefined;
  readonly network?: boolean | undefined;
}

/** The inputs of `verify_changed`. */
export interface VerifyChangedInput extends VerifySiteInput {
  /** A git ref to compare with. Without it, the files that changed since the last run are used. */
  readonly since?: string | undefined;
}

/**
 * Verifies a built site and returns the report JSON, the same text `seaworthy verify --format
 * json` writes. In `changed` mode only the findings in the changed files are reported: a git ref
 * when `since` is given, otherwise the files that differ from the last run, which this run
 * records in `.seaworthy/cache.json`.
 */
async function runVerification(input: VerifyChangedInput, options: VerifyToolOptions, mode: "all" | "changed"): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const checks = options.checks ?? builtInChecks;
  const { config, file: configFile } = loadConfig(cwd, undefined, checks.map((check) => check.meta.id));

  const requested = input.site ?? config.root ?? discoverFolder(cwd);
  if (requested === undefined) throw new Error(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder)) throw new Error(`no folder ${requested}; pass the folder your build writes to, or build first`);
  if (!statSync(folder).isDirectory()) throw new Error(`${requested} is not a folder; pass the folder your build writes to`);

  const label = rootLabel(cwd, folder);
  const base = resolveBasePath({
    folder,
    ...(input.base === undefined ? {} : { override: input.base }),
    ...(config.basePath === undefined ? {} : { configBasePath: config.basePath }),
  });
  const site = buildSite(folder, base.basePath === "/" ? {} : { basePath: base.basePath });

  let changed: Set<string> | undefined;
  let saveCache: (() => void) | undefined;
  if (mode === "changed") {
    if (input.since !== undefined) changed = changedSinceRef(folder, input.since).files;
    else {
      const result = changedSinceLastRun(site, cwd, label);
      changed = result.changed.files;
      saveCache = result.save;
    }
  }

  const { report } = await verifySite({
    folder,
    site,
    ...(changed === undefined ? {} : { changed }),
    rootLabel: label,
    checks,
    config,
    ...(configFile === undefined ? {} : { configLocation: relative(folder, configFile).split("\\").join("/") }),
    rendered: input.rendered === true || config.rendered === true,
    network: input.network === true || config.network === true,
  });
  saveCache?.();
  return reportToJson(report);
}

/** The `verify_site` tool: the report of the whole site. */
export async function verifySiteReport(input: VerifySiteInput, options: VerifyToolOptions = {}): Promise<string> {
  return await runVerification(input, options, "all");
}

/** The `verify_changed` tool: the report of the changed files only. */
export async function verifyChangedReport(input: VerifyChangedInput, options: VerifyToolOptions = {}): Promise<string> {
  return await runVerification(input, options, "changed");
}
