// `--changed`: report only findings in files that changed, so an agent's edit-verify loop stays fast.
//
// Build output is usually not tracked by git, so there are two ways to know what changed:
//   --changed          compare content hashes with the previous run (kept in .seaworthy/cache.json)
//   --changed-since X  ask git which files differ from the ref X (for sites that commit their output)
//
// Limit: a change can break something in a page that did not change, such as a link to a deleted page.
// Findings are filtered by where they are reported; run the full check in CI.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { SiteGraph } from "./site.js";

export const CACHE_FILE = join(".seaworthy", "cache.json");

export class ChangedError extends Error {}

export interface ChangedSet {
  /** Site-relative paths of files that are new or different. */
  files: Set<string>;
  mode: "cache" | "git";
}

function hashFiles(site: SiteGraph): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const url of [...site.files].sort()) {
    hashes[url.slice(1)] = createHash("sha256").update(readFileSync(join(site.root, ...url.slice(1).split("/")))).digest("hex");
  }
  return hashes;
}

interface Cache {
  /** The site folder this cache describes, relative to where verify runs. */
  root: string;
  files: Record<string, string>;
}

/**
 * Files that are new or different since the last run. The first run, or a run on a different folder,
 * counts every file as changed. Call `saveCache` after the run to record the current state.
 */
export function changedSinceLastRun(site: SiteGraph, cwd: string, rootLabel: string): { changed: ChangedSet; save: () => void } {
  const path = join(cwd, CACHE_FILE);
  const current = hashFiles(site);
  let previous: Cache | undefined;
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Cache;
      if (parsed.root === rootLabel && parsed.files && typeof parsed.files === "object") previous = parsed;
    } catch {
      // A damaged cache means "everything changed", the safe answer.
    }
  }
  const files = new Set(Object.keys(current).filter((file) => previous?.files[file] !== current[file]));
  return {
    changed: { files, mode: "cache" },
    save: () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ root: rootLabel, files: current } satisfies Cache, null, 2) + "\n");
    },
  };
}

const git = (folder: string, args: string[]): string => {
  try {
    return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
    throw new ChangedError(`git failed: ${stderr || (error instanceof Error ? error.message : String(error))}`);
  }
};

/** Files in the site folder that differ from `ref`, plus untracked files. Paths are relative to the folder. */
export function changedSinceRef(folder: string, ref: string): ChangedSet {
  if (ref.startsWith("-")) throw new ChangedError(`"${ref}" is not a git ref; pass a branch, tag, or commit that exists in this repository`);
  git(folder, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const tracked = git(folder, ["diff", "--name-only", "--relative", "-z", ref, "--", "."]).split("\0");
  const untracked = git(folder, ["ls-files", "--others", "--exclude-standard", "--full-name", "-z", "--", "."]);
  const prefix = git(folder, ["rev-parse", "--show-prefix"]).trim();
  const files = new Set(tracked.filter(Boolean));
  for (const file of untracked.split("\0").filter(Boolean)) files.add(prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file);
  return { files, mode: "git" };
}
