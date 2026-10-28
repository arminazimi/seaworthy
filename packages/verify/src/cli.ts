#!/usr/bin/env node
// `seaworthy` entry point: `seaworthy verify [dir]`, `seaworthy init [dir]`, `seaworthy fix [dir]`,
// `seaworthy diff`, `seaworthy config check`, `--help`, `--version`. One module per command and
// per option group lives in ./cli/; this file only detects direct invocation, runs the CLI, and
// closes the `--watch` loop on Ctrl-C, then re-exports the API tests and tools import.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { detectColorEnvironment } from "./color.js";
import { run } from "./cli/run.js";
import type { WatchLoop } from "./watch.js";

// Run only when executed directly (including through the npm bin symlink), not when imported by tests.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  /** The loop while the CLI is watching, so Ctrl-C can close the watcher before exiting. */
  let activeWatch: WatchLoop | undefined;
  // ndjson chunks are written as each check finishes; when stdout came out entirely that
  // way, the final write would repeat it byte for byte, so it is skipped. --watch's
  // status lines stay on the same pipes it uses in tests.
  let streamed = "";
  const result = await run(process.argv.slice(2), {
    color: detectColorEnvironment(),
    watch: {
      write: (text: string): void => { process.stdout.write(text); },
      writeError: (text: string): void => { process.stderr.write(text); },
      onLoop: (loop: WatchLoop): void => { activeWatch = loop; },
    },
    stream: (chunk: string): void => { streamed += chunk; process.stdout.write(chunk); },
  });
  if (streamed !== result.stdout) process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
  // Under --watch the process keeps running, one report per change; Ctrl-C must not leave the watcher open.
  if (activeWatch) {
    process.on("SIGINT", () => {
      activeWatch?.close();
      process.exit(130);
    });
  }
}

export { run } from "./cli/run.js";
export { DEFAULT_FOLDERS, EXIT, rootLabel, type CliEnvironment, type CliResult, type WatchProbe } from "./cli/types.js";
export { formatTimings } from "./cli/verify.js";
