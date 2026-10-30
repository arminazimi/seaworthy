// The `wait_for_build` tool: wait for the next build of the site folder, then return its report.
//
// Everything heavy here already exists, and this module only composes it (AGENTS.md: this package
// is a thin adapter over the verify API and owns no check logic):
//
//   the change source  the same recursive `fs.watch` on the build folder that `--watch` opens
//   the settle window  the same `WatchScheduler` debounce, so one build's burst of writes is one wait
//   the report         the byte-stable report JSON `verify_site` returns, from exactly one run
//
// What is new is only the shape of one answer: wait, run once, stop. It never streams findings and
// it is bounded by construction, because a tool that waits can hang the client that called it:
// the wait has an explicit `timeout_ms` with a documented default and a hard upper bound, and it
// honours the request's `AbortSignal` — which the MCP SDK aborts when the client sends
// `notifications/cancelled` for this request, or when the connection closes through the protocol.
// A client that only hangs up its stdin never cancels, and that is exactly why no path here waits
// longer than `timeout_ms`: the bound is what frees a watcher nobody is listening to any more.
// Every path closes the watcher and clears the timer, so no handle outlives the answer and the
// process exits on its own. A verification already under way when the signal aborts is allowed to
// finish, exactly like `--watch` lets a scan in flight finish.

import { existsSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { z } from "zod";

import { builtInChecks, DEFAULT_FOLDERS, discoverFolder, loadConfig, rootLabel, WATCH_DEBOUNCE_MS, WatchScheduler } from "@seaworthy/verify";
import type { Check } from "@seaworthy/verify";

import { VERIFY_SITE_INPUT, verifySiteReport } from "./verify-tools.js";
import type { VerifySiteInput } from "./verify-tools.js";

/** Tool name, as a client would call it. Part of the MCP surface; stable once released. */
export const WAIT_FOR_BUILD_NAME = "wait_for_build";

/** How long `wait_for_build` waits for the next build when the caller says nothing: 30 seconds. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

/** The largest `timeout_ms` a caller may ask for. A wait is never unbounded, so this is capped. */
export const MAX_WAIT_TIMEOUT_MS = 600_000;

export const WAIT_FOR_BUILD_DESCRIPTION =
  `Wait for the next change to the built site folder, and once its writes settle, run the checks once and return the same report JSON as verify_site — one wait, one report, never a stream. Bounded: it gives up with a clear message after timeout_ms without a change (default ${DEFAULT_WAIT_TIMEOUT_MS} ms, at most ${MAX_WAIT_TIMEOUT_MS}) instead of hanging, and a cancelled request stops the watcher. The folder must already exist, because the watcher sits on it and never on the workspace or a folder above it. The site folder and the config resolve against the workspace the server runs in, and the checks that need a browser or the network stay opt-in, as in verify_site.`;

/** The input schema of `wait_for_build`: what `verify_site` takes, plus the bound on the wait. */
export const WAIT_FOR_BUILD_INPUT = {
  ...VERIFY_SITE_INPUT,
  timeout_ms: z
    .number()
    .int()
    .min(1)
    .max(MAX_WAIT_TIMEOUT_MS)
    .optional()
    .describe(`How long to wait, in milliseconds, for the next change to the build folder before answering that none arrived. Default: ${DEFAULT_WAIT_TIMEOUT_MS}; at most ${MAX_WAIT_TIMEOUT_MS}, so the wait is always bounded.`),
};

/** The inputs of `wait_for_build`. */
export interface WaitForBuildInput extends VerifySiteInput {
  /** How long to wait for the next build. Defaults to {@link DEFAULT_WAIT_TIMEOUT_MS}. */
  readonly timeout_ms?: number | undefined;
}

/** Opens the change source and closes it again; the same seam verify's `WatchLoopOptions.open` uses. */
export type ChangeSource = (hooks: { change: () => void; failed: (error: unknown) => void }) => { close(): void };

export interface WaitForBuildOptions {
  /** The workspace the site folder and the config resolve against. Default: process.cwd(). */
  readonly cwd?: string;
  /** The checks to run once the build lands. Default: verify's built-in checks. */
  readonly checks?: readonly Check[];
  /** The MCP request's abort signal; aborting closes the watcher and ends the wait. */
  readonly signal?: AbortSignal;
  /** Quiet window, in ms, that ends the wait after the last change event. Default: verify's `WATCH_DEBOUNCE_MS`. */
  readonly debounceMs?: number;
  /** Test seam for the change source. Default: a recursive `fs.watch` on the site folder and nothing else. */
  readonly open?: ChangeSource;
}

/** The default change source: what `--watch` opens, a recursive `fs.watch` on the build folder. */
function watchFolderForChanges(folder: string): ChangeSource {
  return (hooks) => {
    const watcher: FSWatcher = watch(folder, { recursive: true }, () => hooks.change());
    watcher.on("error", hooks.failed);
    return { close: () => watcher.close() };
  };
}

export interface BuildWaitOptions {
  /** How long to wait before answering that no build arrived. Clamped to 1..{@link MAX_WAIT_TIMEOUT_MS}. */
  readonly timeoutMs: number;
  /** The folder as a report names it, used only in the messages so they never carry an absolute path. */
  readonly label: string;
  readonly debounceMs?: number;
  readonly signal?: AbortSignal;
  readonly open?: ChangeSource;
}

/**
 * Resolves once `folder` has changed and then stayed quiet for one debounce window — the settle
 * `--watch` uses. Rejects with a `wait_for_build:` message when the timeout passes, the signal
 * aborts, or the watcher itself fails. Either way the watcher is closed and the timer cleared
 * first, so the rejected promise is also the last thing this wait leaves running.
 *
 * `--watch` ignores events for `.seaworthy/cache.json` because a re-run writes it and would
 * announce itself; that filter is not needed here: this wait ends at the first settle, so a
 * self-caused event can never loop, and the cache file lives in the workspace, which a caller
 * cannot ask this tool to watch.
 */
export function waitForNextBuild(folder: string, options: BuildWaitOptions): Promise<void> {
  const timeoutMs = Math.min(Math.max(1, Math.trunc(options.timeoutMs)), MAX_WAIT_TIMEOUT_MS);
  const debounceMs = Math.max(0, options.debounceMs ?? WATCH_DEBOUNCE_MS);
  const open = options.open ?? watchFolderForChanges(folder);
  const label = options.label;
  const signal = options.signal;

  return new Promise<void>((resolveWait, rejectWait) => {
    let handle: { close(): void } | undefined;
    let ended = false;

    const closeWatcher = (source: { close(): void }): void => {
      try {
        source.close();
      } catch {
        // The folder is gone and the watcher with it; there is nothing left to stop.
      }
    };
    /** Ends the wait for good: stop watching, stop the clock, then answer. */
    function end(finish: () => void): void {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      scheduler.stop();
      signal?.removeEventListener("abort", onAbort);
      if (handle !== undefined) closeWatcher(handle);
      finish();
    }

    const timer = setTimeout(() => {
      end(() => rejectWait(new Error(`wait_for_build: ${label} did not change within ${timeoutMs} ms; nothing was verified. Call verify_site for the build as it stands, or wait_for_build again to keep waiting.`)));
    }, timeoutMs);
    // The scan the scheduler runs once the folder has been quiet: for this tool, the settle itself.
    const scheduler = new WatchScheduler(async () => {
      end(() => resolveWait());
    }, { debounceMs });
    const onAbort = (): void => {
      end(() => rejectWait(new Error(`wait_for_build: ${label} was not verified: the request was cancelled while waiting for the next build.`)));
    };

    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      handle = open({
        change: () => {
          if (!ended) scheduler.changed();
        },
        failed: (error) => {
          const detail = error instanceof Error ? error.message : String(error);
          end(() => rejectWait(new Error(`wait_for_build: the watcher for ${label} stopped: ${detail}; nothing was verified.`)));
        },
      });
      // Aborted or timed out while the source was opening: close what was just opened.
      if (ended) closeWatcher(handle);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      end(() => rejectWait(new Error(`wait_for_build: cannot watch ${label}: ${detail}`)));
    }
  });
}

/**
 * The folder to watch: resolved with the three answers `verify_site` uses (the argument, then the
 * config's `root`, then the first default folder that exists) and the same three messages when the
 * folder is not there, so a wrong folder reads alike whichever tool you call.
 *
 * Two guards are added, because watching is heavier than reading one folder:
 *   - the folder must exist now, since a watcher has nothing to sit on otherwise; and
 *   - it must not be the workspace or a folder above it, which would put every source file, every
 *     `node_modules`, and for `/` the whole machine under the watch.
 * The second runs on `realpathSync`, so a folder handed over as a symlink is judged where it
 * really is: `dist -> ..` would otherwise slip the workspace in under the watcher. A folder
 * *outside* the workspace stays allowed, because `verify_site` already reads those on the caller's
 * word; what is refused is watching something that contains the workspace.
 */
function watchTarget(cwd: string, requestedSite: string | undefined, checks: readonly Check[]): string {
  const { config } = loadConfig(cwd, undefined, checks.map((check) => check.meta.id));
  const requested = requestedSite ?? config.root ?? discoverFolder(cwd);
  if (requested === undefined) throw new Error(`no built site found. Pass a folder, or build first so one of ${DEFAULT_FOLDERS.join(", ")} exists.`);
  const folder = resolve(cwd, requested);
  if (!existsSync(folder)) throw new Error(`no folder ${requested}; pass the folder your build writes to, or build first`);
  if (!statSync(folder).isDirectory()) throw new Error(`${requested} is not a folder; pass the folder your build writes to`);

  const rel = relative(realpathSync(cwd), realpathSync(folder));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`wait_for_build: refuses to watch ${requested}: it is the workspace or a folder above it, so the watcher would see every source file instead of the build. Pass the folder your build writes to, for example dist.`);
  }
  return folder;
}

/**
 * The `wait_for_build` tool: one wait, then one report. The folder is resolved here and handed to
 * `verify_site` as a path, not re-derived from the caller's words, so the report is guaranteed to
 * be of the folder the watcher was sitting on even if a build swaps what a name points at
 * mid-wait. The report is the normal one — same JSON, same byte-stability, no second shape.
 */
export async function waitForBuildReport(input: WaitForBuildInput, options: WaitForBuildOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const checks = options.checks ?? builtInChecks;
  const folder = watchTarget(cwd, input.site, checks);
  await waitForNextBuild(folder, {
    timeoutMs: input.timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS,
    label: rootLabel(cwd, folder),
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.open === undefined ? {} : { open: options.open }),
  });
  const { timeout_ms: _timeout, ...verifyInput } = input;
  // The path the watcher sat on, not the caller's words: `verify_site` labels the folder from the
  // workspace either way, and a build that re-points the name mid-wait cannot make this report
  // describe a different folder than the one that was watched.
  return await verifySiteReport({ ...verifyInput, site: folder }, { checks, cwd });
}
