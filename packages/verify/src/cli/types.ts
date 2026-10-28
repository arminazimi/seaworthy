// Pieces every command module shares: exit codes, the result envelope, the environment
// hooks, and the usage error. The folder helpers live in ../folders.js, shared with the MCP server.

import type { ColorEnvironment } from "../color.js";
import type { WatchLoop } from "../watch.js";
import type { Check } from "../types.js";

export { DEFAULT_FOLDERS, rootLabel } from "../folders.js";

export const EXIT = {
  /** No findings at or above the failing severity. */
  ok: 0,
  /** Findings at or above the failing severity. */
  findings: 1,
  usage: 2,
  /** A check or the engine crashed. */
  internal: 4,
} as const;

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
  /**
   * Called with output as the run produces it, so streaming formats can go out live
   * (currently ndjson, one finding per line). Chunks end in a newline and, when the whole
   * stdout is streamed this way, the returned `stdout` holds exactly their concatenation,
   * so a caller can avoid writing it twice.
   */
  stream?: (chunk: string) => void;
}
