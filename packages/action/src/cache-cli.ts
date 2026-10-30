// seaworthy action cache — the one cache value `action.yml` needs from TypeScript: the key.
//
//   node dist/src/cache-cli.js key
//
// Writes `history-key=<key>` to $GITHUB_OUTPUT (and the key to stdout) for the `actions/cache`
// step that follows. The key itself is `./cache.ts`'s pure function of the runner's environment and
// the workspace config, so the YAML never assembles a cache name out of expressions it cannot test.
//
// Caching must never be the reason a run fails (issue #261): every failure here leaves the key
// unset, the step that needs it is `if:`-guarded on a non-empty key, and the exit code stays 0.
// Only a wrong command on this file's own argv is a usage error, and that is a bug in the workflow,
// not in the site or the cache.

import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_FILE } from "@seaworthy/verify";

import { cacheKeyFromEnv } from "./cache.js";

/** The name the cache step reads out of $GITHUB_OUTPUT. */
export const CACHE_KEY_OUTPUT = "history-key";

const USAGE = `seaworthy action cache

Commands:
  key    Write the history cache key for this run to $GITHUB_OUTPUT as ${CACHE_KEY_OUTPUT}=<key>
         (empty output means the key could not be worked out, and the cache step skips).
`;

export interface CacheCliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The key, when it was computed; the caller appends it to GITHUB_OUTPUT only when it is not "". */
  key: string;
}

/**
 * The workspace's config text, as the key's config part: "" when there is no `seaworthy.config.json`
 * to read. The CLI fails the run on a config it cannot load at all, so a file that is unreadable
 * here never reaches a cached store — and a missing one is a real state, not an error.
 */
export function workspaceConfig(cwd: string): string {
  try {
    return readFileSync(join(cwd, CONFIG_FILE), "utf8");
  } catch {
    return "";
  }
}

/** The key for this run, from the environment the runner gives. "" means: do not use a cache. */
export function cacheKey(env: Readonly<Record<string, string | undefined>>, cwd: string = env.GITHUB_WORKSPACE ?? process.cwd()): string {
  try {
    return cacheKeyFromEnv(env, workspaceConfig(cwd));
  } catch {
    // A cache key this Action cannot work out is a reason to cache nothing, never to fail.
    return "";
  }
}

/** One `cache` command run: arguments and environment in, exit state and key out. No side effects. */
export function run(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): CacheCliResult {
  if (argv[0] !== "key") {
    return { code: 2, stdout: "", stderr: `seaworthy action cache: unknown command "${argv[0] ?? ""}"; use key\n${USAGE}`, key: "" };
  }
  const key = cacheKey(env);
  if (key === "") return { code: 0, stdout: "", stderr: "seaworthy: history cache disabled: this run's cache key could not be worked out.\n", key };
  const output = env.GITHUB_OUTPUT;
  if (output !== undefined && output !== "") {
    try {
      appendFileSync(output, `${CACHE_KEY_OUTPUT}=${key}\n`);
    } catch {
      // The step output is missing: the guarded cache step skips and the run continues without it.
    }
  }
  return { code: 0, stdout: `${key}\n`, stderr: "", key };
}

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
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
