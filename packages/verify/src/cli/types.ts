// Pieces every command module shares: exit codes, the result envelope, the environment
// hooks, the usage error, and the folder-label helper.

import { basename, isAbsolute, relative } from "node:path";

import type { ColorEnvironment } from "../color.js";
import type { WatchLoop } from "../watch.js";
import type { Check } from "../types.js";

export const EXIT = {
  /** No findings at or above the failing severity. */
  ok: 0,
  /** Findings at or above the failing severity. */
  findings: 1,
  usage: 2,
  /** A check or the engine crashed. */
  internal: 4,
} as const;

/** Folders a build usually writes to, in the order they are tried when no folder is given. */
export const DEFAULT_FOLDERS = ["dist", "build", "out", "public", "_site", "site"] as const;

/** A command rejected how it was invoked; `run` turns this into the usage exit code. */
export class UsageError extends Error {}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** How `--watch` reports and hands the loop over. Test hooks; the real CLI passes none. */
export interface WatchProbe {
  /** Quiet window between a burst of changes and a re-run. Default: 200 ms. */
  debounceMs?: number;
  /** Where watch status goes. Default: process.stdout. */
  write?: (text: string) => void;
  /** Where watch failures go. Default: process.stderr. */
  writeError?: (text: string) => void;
  /** Called with the running loop, so a test can wait for or stop it. */
  onLoop?: (loop: WatchLoop) => void;
}

export interface CliEnvironment {
  /** Base for relative paths. Default: process.cwd(). */
  cwd?: string;
  /** Checks to run. Default: the built-in checks. */
  checks?: readonly Check[];
  /** Terminal and NO_COLOR detection for human output. Default: undefined, which keeps every byte plain. */
  color?: ColorEnvironment;
  /** Test hooks for `--watch`. Default: status on stdout, failures on stderr. */
  watch?: WatchProbe;
}

/** The folder as a relative label, so reports never contain absolute paths. */
export function rootLabel(cwd: string, folder: string): string {
  const rel = relative(cwd, folder);
  if (rel === "") return ".";
  if (isAbsolute(rel)) return basename(folder); // a different drive on Windows
  return rel.split("\\").join("/");
}
