// Progress plumbing for the MCP tools (issue #252): standard `notifications/progress` for
// long runs, opt-in per call.
//
// What the verify engine actually exposes is coarse, and this module says only that. The engine
// runs every check in parallel (packages/verify/src/engine.ts) and has no per-page event stream:
// pages are parsed inside the synchronous `buildSite`, before any check starts. The only
// mid-run signal is verify's `streamFindings` option (packages/verify/src/verify.ts), called
// with one finding the moment its check finishes, after the report's own filters. So progress
// honestly reports: the run started, how many pages were parsed, that the checks are running,
// every finding so far, and that the run finished. It never reports a percentage: the engine
// exposes no total-work figure, so `total` is left out of every notification.
//
// SDK 1.32.2 surface used (all read in node_modules/@modelcontextprotocol/sdk):
// - server/mcp.js:492 — the registered tool callback is invoked as `cb(args, extra)`.
// - shared/protocol.js:345 — `extra._meta` is the request's `params._meta`, whose `progressToken`
//   the SDK types define (types.d.ts:49); `extra.sendNotification` (protocol.js:346) sends a
//   notification bound to this request.
// - server/index.js:195 — `notifications/progress` needs no declared server capability:
//   "Progress notifications are always allowed". The payload is the SDK's own
//   ProgressNotificationSchema (types.d.ts:954): progressToken, progress, optional total/message.

import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ProgressNotification, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

/** The slice of the SDK's per-request `extra` a progress reporter needs. */
export type ToolRequestExtra = Pick<RequestHandlerExtra<ServerRequest, ServerNotification>, "_meta" | "sendNotification">;

/** One progress update: a human-readable message for the caller that asked for progress. */
export type ProgressReporter = (message: string) => void;

/**
 * The progress reporter for one tool call, or undefined when the caller sent no
 * `_meta.progressToken` — progress is opt-in per call. Sending is fire-and-forget with the
 * error swallowed: a slow or absent client never slows the run and never fails it.
 */
export function createProgressReporter(extra: ToolRequestExtra): ProgressReporter | undefined {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return undefined;
  let step = 0;
  return (message) => {
    step += 1;
    const notification: ProgressNotification = {
      method: "notifications/progress",
      params: { progressToken, progress: step, message },
    };
    void extra.sendNotification(notification).catch(() => {
      // The client hung up or the transport failed. Progress is a courtesy; the run continues.
    });
  };
}

/**
 * Adds the caller's progress reporter to a tool's options, only when the caller asked for
 * progress. Without a progress token the options — and therefore the run and its result — are
 * returned untouched, byte for byte.
 */
export function withProgress<T extends object>(options: T, extra: ToolRequestExtra): T & { progress?: ProgressReporter } {
  const progress = createProgressReporter(extra);
  return progress === undefined ? options : { ...options, progress };
}
