// The worker pool that runs static built-in checks in parallel (issue #218).
//
// The engine hands it one job per worker-safe check; each job runs in a `node:worker_threads`
// worker over its OWN rebuild of the site graph. `buildSite` is deterministic for a folder of
// built output, so every worker sees exactly the graph the main thread sees — the graph itself
// cannot travel between threads: `SiteGraph` carries functions, and a parse5 tree is a cyclic
// object graph that would cost more to clone per check than the pages cost to parse.
//
// The pool never reorders anything: it reports one outcome per job, in completion order, and
// the engine assembles findings by the position of the check in the run, so the report is
// byte-identical to a sequential run no matter which worker finished first.
//
// `SEAWORTHY_WORKERS` overrides the decision: `0` or `1` forces the sequential path, `2` or
// more forces the pool with at most that many workers (used by the parity tests and by
// `tools/bench-large.mjs`). A non-numeric value is ignored.

import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import type { MarkdownSources } from "./markdown.js";
import type { Check, FindingDraft, Needs } from "./types.js";

/**
 * Site pages at or above which the pool pays for its own startup. Tuned on the 10,000-page
 * benchmark (`node tools/bench-large.mjs`): below roughly 2,000 pages the per-worker graph
 * rebuild and thread start cost more than the parallel checks save; from 2,000 up the pool
 * wins, and at 10,000 it runs ~1.3x faster overall on the tuning machine.
 */
export const PARALLEL_MIN_PAGES = 2000;

/**
 * Upper bound on worker threads, whatever the machine offers. Each worker holds its own
 * rebuild of the site graph: past ~4 threads the simultaneous rebuilds contend for memory
 * bandwidth and the run gets slower again (measured on 10 logical CPUs: 4 workers 1.27x,
 * 6 workers 1.18x, 9 workers ~1.0x at 10,000 pages).
 */
export const MAX_PARALLEL_WORKERS = 4;

/** The needs a check may declare and still run in a worker: only data already in the graph or the built folder. */
const WORKER_SAFE_NEEDS: readonly Needs[] = ["html", "files"];

/** One check for one worker: everything needed to rebuild the graph and build the check's context. */
export interface WorkerJob {
  checkId: string;
  /** Absolute site root, as `SiteGraph.root` holds it. */
  root: string;
  /** The normalized base path, as `SiteGraph.basePath` holds it. */
  basePath: string;
  /** The check's own options, from the config. */
  options: Readonly<Record<string, unknown>>;
  /** `--changed` files, as a sorted list; the worker rebuilds the set. */
  changed?: string[];
  /** `--markdown` sources, when given; plain data, safe to clone. */
  markdownSources?: MarkdownSources;
}

/** What a worker reports back for one job. */
export type WorkerOutcome =
  | { kind: "findings"; checkId: string; drafts: FindingDraft[]; ms: number }
  | { kind: "error"; checkId: string; message: string; ms: number }
  /** The check cannot cross the thread boundary (an unclonable draft, a dead worker): the engine reruns it on the main thread. */
  | { kind: "fallback"; checkId: string };

/** True when a check may run in a worker: the very object the generated registry holds, static, with no pre-flight probe. */
export function workerSafe(check: Check, builtIn: readonly Check[]): boolean {
  if (check.probe !== undefined) return false;
  if (!check.meta.needs.every((need) => WORKER_SAFE_NEEDS.includes(need))) return false;
  // Identity, not just ID: a caller that passed its own object with a built-in's ID must run on the main thread.
  return builtIn.includes(check);
}

/**
 * How many workers this run gets; 0 means run everything on the main thread.
 * `pages` is the site size, `candidates` the number of worker-safe checks in the run.
 */
export function workerBudget(pages: number, candidates: number): number {
  if (candidates < 2) return 0;
  const forced = forcedWorkerCount();
  if (forced !== undefined) return forced === 0 ? 0 : Math.min(forced, candidates);
  if (pages < PARALLEL_MIN_PAGES) return 0;
  return Math.min(candidates, MAX_PARALLEL_WORKERS, Math.max(1, availableParallelism() - 1));
}

/** The `SEAWORTHY_WORKERS` override, or undefined when unset or unusable. Fewer than 2 means sequential. */
function forcedWorkerCount(): number | undefined {
  const raw = process.env.SEAWORTHY_WORKERS;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined;
  const count = Number(raw.trim());
  return count < 2 ? 0 : count;
}

const WORKER_SCRIPT = new URL("./check-worker.js", import.meta.url);

/**
 * Run every job over at most `workers` threads, one job at a time per thread, calling
 * `onOutcome` as each outcome lands. The promise resolves when every job has exactly one
 * outcome. A worker that dies mid-job reports that job as a fallback, and a job no worker
 * can take falls back too: the pool can lose a thread, never a check.
 */
export function runCheckPool(jobs: readonly WorkerJob[], workers: number, onOutcome: (outcome: WorkerOutcome) => void): Promise<void> {
  return new Promise((resolve) => {
    const queue = [...jobs];
    // Jobs still owed an outcome, whether queued, running, or awaiting a fallback report.
    let owed = jobs.length;
    let threads = 0;

    const settle = (outcome: WorkerOutcome): void => {
      owed -= 1;
      onOutcome(outcome);
    };

    const finishIfDone = (): void => {
      if (owed === 0) resolve();
    };

    interface PoolSlot {
      worker: Worker | undefined;
      /** The job this worker is running, so its death can be reported as that job's fallback. */
      current: WorkerJob | undefined;
    }
    const slots: PoolSlot[] = [];

    const giveWork = (slot: PoolSlot): void => {
      const job = queue.shift();
      if (job === undefined || slot.worker === undefined) {
        if (slot.worker !== undefined) void slot.worker.terminate();
        return;
      }
      slot.current = job;
      slot.worker.postMessage(job);
    };

    const retire = (slot: PoolSlot): void => {
      if (slot.worker === undefined) return;
      slot.worker = undefined;
      threads -= 1;
      const lost = slot.current;
      slot.current = undefined;
      if (lost !== undefined) settle({ kind: "fallback", checkId: lost.checkId });
      // Hand the queue to the workers that are still up and idle.
      for (const other of slots) if (other !== slot && other.worker !== undefined && other.current === undefined) giveWork(other);
      while (threads === 0 && queue.length > 0) {
        const job = queue.shift();
        if (job !== undefined) settle({ kind: "fallback", checkId: job.checkId });
      }
      finishIfDone();
    };

    const count = Math.min(Math.max(0, workers), jobs.length);
    for (let i = 0; i < count; i += 1) {
      const slot: PoolSlot = { worker: undefined, current: undefined };
      slots.push(slot);
      try {
        const worker = new Worker(WORKER_SCRIPT);
        slot.worker = worker;
        threads += 1;
        worker.on("message", (outcome: WorkerOutcome) => {
          slot.current = undefined;
          settle(outcome);
          giveWork(slot);
          finishIfDone();
        });
        worker.on("error", () => retire(slot));
        worker.on("close", () => retire(slot));
        giveWork(slot);
      } catch {
        // A thread cannot even start: its checks belong to the main thread.
        retire(slot);
      }
    }
    // No worker at all (budget zeroed mid-way or every start failed): everything falls back.
    while (threads === 0 && queue.length > 0) {
      const job = queue.shift();
      if (job !== undefined) settle({ kind: "fallback", checkId: job.checkId });
    }
    finishIfDone();
  });
}
