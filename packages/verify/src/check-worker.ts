// One worker thread of the check pool (issue #218): runs built-in static checks by ID over
// a site graph it rebuilds itself. `buildSite` is deterministic, so this graph is the same
// graph the main thread built — page for page, id for id.
//
// The worker takes one job at a time. It never crashes the pool: anything `check.run` throws
// becomes an error outcome (the same text the sequential engine would record), and a result
// that cannot cross the clone boundary becomes a fallback outcome, which reruns the check on
// the main thread.

import { performance } from "node:perf_hooks";
import { parentPort } from "node:worker_threads";

import { builtInChecks } from "./checks/registry.js";
import { buildSite, type SiteGraph } from "./site.js";
import type { CheckContext, FindingDraft } from "./types.js";
import type { WorkerJob, WorkerOutcome } from "./check-pool.js";

const port = parentPort;
if (port) {
  const byId = new Map(builtInChecks.map((check) => [check.meta.id, check]));
  let graph: SiteGraph | undefined;
  let graphKey = "";

  port.on("message", async (job: WorkerJob) => {
    const outcome = await run(job, byId, () => {
      const key = `${job.root}\u0000${job.basePath}`;
      if (graph === undefined || graphKey !== key) {
        graph = buildSite(job.root, { basePath: job.basePath });
        graphKey = key;
      }
      return graph;
    });
    try {
      port.postMessage(outcome);
    } catch {
      // The drafts are not cloneable: give up and let the main thread run this check itself.
      port.postMessage({ kind: "fallback", checkId: job.checkId } satisfies WorkerOutcome);
    }
  });
}

async function run(
  job: WorkerJob,
  byId: Map<string, (typeof builtInChecks)[number]>,
  site: () => SiteGraph,
): Promise<WorkerOutcome> {
  const startedAt = performance.now();
  try {
    const check = byId.get(job.checkId);
    if (check === undefined) return { kind: "error", checkId: job.checkId, message: `unknown check ID ${job.checkId}`, ms: 0 };
    const context: CheckContext = {
      site: site(),
      options: job.options,
      signal: new AbortController().signal,
      ...(job.changed === undefined ? {} : { changed: new Set(job.changed) }),
      ...(job.markdownSources === undefined ? {} : { markdownSources: job.markdownSources }),
    };
    const drafts: FindingDraft[] = [];
    for await (const draft of check.run(context)) drafts.push(draft);
    return { kind: "findings", checkId: job.checkId, drafts, ms: performance.now() - startedAt };
  } catch (error) {
    return { kind: "error", checkId: job.checkId, message: error instanceof Error ? error.message : String(error), ms: performance.now() - startedAt };
  }
}
