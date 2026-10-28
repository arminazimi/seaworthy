// `--watch`: verify again whenever the build folder changes and report only what changed.
//
// The diff reuses the existing machinery: `diffReports`, the same function behind
// `seaworthy diff`, turns two consecutive reports into new, fixed, and unchanged
// findings by fingerprint. Three pieces, each testable without the others:
//
//   watchStatusText — pure: one report against a previous one, rendered as a compact status
//   WatchScheduler  — debounces bursts of change events and never runs two scans at once
//   WatchLoop       — the thin integration: fs.watch on the build folder, wired to the scheduler

import { watch, type FSWatcher } from "node:fs";

import { CACHE_FILE } from "./changed.js";
import { diffReports, type ReportDiff } from "./diff.js";
import { describeLocation } from "./formats/pretty.js";
import type { Finding, Report } from "./types.js";

function where(finding: Finding): string {
  const at = describeLocation(finding);
  return at === "-" ? finding.location.file : `${finding.location.file}:${at}`;
}

/**
 * The whole status text for one change, in the style of the other `seaworthy:` lines: a counting
 * headline, then one `+` line per new and one `-` line per fixed finding. Findings arrive sorted
 * from `diffReports`, so the same two reports always produce the same bytes.
 */
export function watchStatusText(before: Report, after: Report): string {
  const diff = diffReports(before, after);
  return watchDiffText(diff);
}

/** The status text for a diff already computed, shared by the watch loop and `seaworthy diff`. */
export function watchDiffText(diff: ReportDiff): string {
  const counts = diff.summary;
  const total = counts.new + counts.fixed + counts.unchanged;
  if (counts.new === 0 && counts.fixed === 0) return `seaworthy: no findings changed (${counts.unchanged} unchanged)\n`;
  const prefix = diff.after.root === "." ? "" : `${diff.after.root}/`;
  const lines = [
    `seaworthy: ${counts.new} new, ${counts.fixed} fixed, ${counts.unchanged} unchanged finding${total === 1 ? "" : "s"}`,
    ...diff.new.map((f) => `  + ${f.severity} ${f.checkId} ${prefix}${where(f)}: ${f.message}`),
    ...diff.fixed.map((f) => `  - ${f.severity} ${f.checkId} ${prefix}${where(f)}: ${f.message} (fixed)`),
  ];
  return lines.join("\n") + "\n";
}

/** Quiet window after the last change event before a scan starts: a burst of writes is one run. */
export const WATCH_DEBOUNCE_MS = 200;

export interface WatchSchedulerOptions {
  /** Defaults to {@link WATCH_DEBOUNCE_MS}. */
  debounceMs?: number;
  /** A scan that threw; the scheduler runs no further scan itself, so the caller owns recovery. */
  onError?: (error: unknown) => void;
}

/**
 * Scheduling between change events and scans. One scan is ever in flight; while one runs, further
 * events coalesce into exactly one queued follow-up scan instead of piling up.
 */
export class WatchScheduler {
  readonly debounceMs: number;
  private readonly scan: () => Promise<void>;
  private readonly onError?: (error: unknown) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private pending = false;
  /** Scans that have completed, for tests. */
  runs = 0;

  constructor(scan: () => Promise<void>, options: WatchSchedulerOptions = {}) {
    this.scan = scan;
    this.debounceMs = Math.max(0, options.debounceMs ?? WATCH_DEBOUNCE_MS);
    if (options.onError !== undefined) this.onError = options.onError;
  }

  get busy(): boolean {
    return this.running;
  }

  /** A scan is running and one follow-up is already claimed by the events so far. */
  get rerunQueued(): boolean {
    return this.pending;
  }

  /** A file changed. Nothing runs before the folder has been quiet for a debounce window. */
  changed(): void {
    this.clear();
    if (this.running) {
      this.pending = true;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.scanNow();
    }, this.debounceMs);
  }

  /** Runs one scan now. A scan already in flight is never entered again; the event just queues a rerun. */
  async scanNow(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.clear();
    this.running = true;
    try {
      await this.scan();
      this.runs++;
    } catch (error) {
      this.onError?.(error);
    }
    this.running = false;
    if (this.pending) {
      // Re-debounce so events that arrive right after the scan collapse into the round they missed.
      this.pending = false;
      this.changed();
    }
  }

  /** Cancels any scheduled scan. A scan already running is allowed to finish. */
  stop(): void {
    this.clear();
  }

  private clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

export interface WatchLoopOptions {
  /** The build folder to watch, recursively. */
  folder: string;
  /** The report of the run the caller already printed; every later run diffs against it. */
  previous: Report;
  /** Produces a fresh report. Throwing is caught and reported; watching continues. */
  run: () => Promise<Report>;
  /** Delivers the status text for every run after the first. */
  notify: (text: string) => void;
  /** Delivers a notice when the run or the watcher fails. The loop does not crash either way. */
  error: (text: string) => void;
  /** Defaults to {@link WATCH_DEBOUNCE_MS}. */
  debounceMs?: number;
  /** Test hook: opens the change source. Default: fs.watch on `folder`, recursive. */
  open?: (hooks: { change: () => void; failed: (error: unknown) => void }) => { close(): void };
}

// The runs themselves never write outside the watched folder except a parallel process using
// .seaworthy/cache.json; events for the cache file would announce a run that caused them.
function feedsBack(filename: string | null): boolean {
  if (filename === null) return false;
  return filename.split(/[\\/]/).slice(-2).join("/") === CACHE_FILE.split(/[\\/]/).slice(-2).join("/");
}

const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Reports on every change to the build folder after the first run: watcher + scheduler + status. */
export class WatchLoop {
  private readonly options: WatchLoopOptions;
  private readonly scheduler: WatchScheduler;
  private last: Report;
  private handle: { close(): void } | undefined;
  private quiet = false;

  constructor(options: WatchLoopOptions) {
    this.options = options;
    this.last = options.previous;
    this.scheduler = new WatchScheduler(() => this.scan(), {
      ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    });
  }

  /** Opens the watcher. Failure to open, or a watcher that fails later, is reported, not thrown. */
  start(): void {
    // Events after close re-arm nothing: a closed loop never scans again.
    const hooks = { change: () => { if (!this.quiet) this.scheduler.changed(); }, failed: (error: unknown) => this.failed(error) };
    try {
      this.handle = this.options.open ? this.options.open(hooks) : this.openFsWatcher(hooks);
    } catch (error) {
      this.failed(error);
    }
  }

  private openFsWatcher(hooks: { change: () => void; failed: (error: unknown) => void }): { close(): void } {
    const watcher: FSWatcher = watch(this.options.folder, { recursive: true }, (_event, filename) => {
      if (!feedsBack(filename)) hooks.change();
    });
    watcher.on("error", hooks.failed);
    return { close: () => watcher.close() };
  }

  /** Stops watching and cancels a scheduled scan; a scan already running finishes, but silently. */
  close(): void {
    this.quiet = true;
    this.scheduler.stop();
    const handle = this.handle;
    this.handle = undefined;
    handle?.close();
  }

  get runs(): number {
    return this.scheduler.runs;
  }

  get busy(): boolean {
    return this.scheduler.busy;
  }

  get rerunQueued(): boolean {
    return this.scheduler.rerunQueued;
  }

  private async scan(): Promise<void> {
    let after: Report;
    try {
      after = await this.options.run();
    } catch (error) {
      if (!this.quiet) this.options.error(`seaworthy: watch: verification failed; still watching (${detailOf(error)})\n`);
      return;
    }
    if (this.quiet) return;
    this.options.notify(watchDiffText(diffReports(this.last, after)));
    // The next run diffs against this one, so each run is reported against exactly one predecessor.
    this.last = after;
  }

  private failed(error: unknown): void {
    if (this.quiet) return;
    this.options.error(`seaworthy: watch: the watcher stopped (${detailOf(error)})\n`);
    this.close();
  }
}
