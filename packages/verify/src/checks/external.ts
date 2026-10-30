// links.external: external http(s) links that no longer work. Opt-in (needs the network).
//
// Behaviors borrowed from existing link checkers (ADR 0007): HEAD first, GET when HEAD is refused;
// bot-protection and rate-limit responses are skipped, not reported; each URL is fetched once per run.
// Built HTML pages and the Markdown sources in the verified folder share one URL set, so a link that
// appears in both is still fetched once, and each occurrence is located where it was written.

import { type HtmlElement, type Page, attr } from "../site.js";
import type { Check, FindingDraft, Location } from "../types.js";
import { check, locate, meta, pagesOf } from "./helpers.js";
import { markdownOf } from "./markdown-graph.js";

export interface ExternalOptions {
  timeoutMs: number;
  concurrency: number;
  /** Regular expressions (as strings); matching URLs are not checked. */
  ignore: string[];
}
const DEFAULTS: ExternalOptions = { timeoutMs: 10_000, concurrency: 8, ignore: [] };
const PER_HOST = 2;

/** Statuses that mean "we cannot tell", not "the link is broken": auth walls, rate limits, bot protection. */
const UNDECIDED = new Set([401, 403, 429, 999]);

type Verdict = { kind: "ok" } | { kind: "skipped"; reason: string } | { kind: "broken"; status: number } | { kind: "server-error"; status: number } | { kind: "unreachable"; reason: string };

export async function probe(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Verdict> {
  const attempt = async (method: "HEAD" | "GET"): Promise<Response> => fetchImpl(url, { method, redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "seaworthy (link check)", accept: "*/*" } });
  try {
    let response = await attempt("HEAD");
    if (response.status >= 400) response = await attempt("GET"); // many servers refuse or mishandle HEAD
    if (response.headers.get("cf-mitigated")) return { kind: "skipped", reason: "bot protection" };
    if (response.status < 400) return { kind: "ok" };
    if (UNDECIDED.has(response.status)) return { kind: "skipped", reason: `status ${response.status}` };
    return response.status >= 500 ? { kind: "server-error", status: response.status } : { kind: "broken", status: response.status };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error);
    return { kind: "unreachable", reason: timedOut ? `no answer within ${timeoutMs / 1000} seconds` : cause };
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const HTTP_URL = /^https?:\/\//i;

function* externalLinks(page: Page): Generator<{ element: HtmlElement; url: string }> {
  for (const element of page.elements) {
    if (element.tagName !== "a" && element.tagName !== "area") continue;
    const href = attr(element, "href");
    if (href !== undefined && HTTP_URL.test(href.trim())) yield { element, url: href.trim() };
  }
}

/** Runs `worker` over `items` with at most `limit` at once overall and `perHost` per host. */
async function pool<T>(items: readonly T[], hostOf: (item: T) => string, limit: number, perHost: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const active = new Map<string, number>();
  let running = 0;
  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (queue.length === 0 && running === 0) return resolve();
      for (let i = 0; i < queue.length && running < limit; ) {
        const item = queue[i] as T;
        const host = hostOf(item);
        if ((active.get(host) ?? 0) >= perHost) {
          i++;
          continue;
        }
        queue.splice(i, 1);
        running++;
        active.set(host, (active.get(host) ?? 0) + 1);
        void worker(item).finally(() => {
          running--;
          active.set(host, (active.get(host) ?? 1) - 1);
          pump();
        });
      }
    };
    pump();
  });
}

export function externalLinksCheck(fetchImpl: typeof fetch = (...args) => fetch(...args)): Check {
  return check(meta("links.external", "External link is broken", "error", [], ["html", "network"]), async function* (ctx) {
    const options = { ...DEFAULTS, ...ctx.options } as ExternalOptions;
    const ignore = options.ignore.map((pattern) => new RegExp(pattern));
    const kept = (url: string): boolean => !ignore.some((re) => re.test(url));
    const occurrences = new Map<string, Location[]>();
    const add = (url: string, location: Location): void => {
      occurrences.set(url, [...(occurrences.get(url) ?? []), location]);
    };
    for (const page of pagesOf(ctx)) {
      for (const { element, url } of externalLinks(page)) {
        if (kept(url)) add(url, locate(page, element, "href"));
      }
    }
    // Markdown sources share this check's URL set, probe, and pools; the graph is only read when
    // this network-enabled check runs, so files sorted by path and document order keep findings deterministic.
    const graph = markdownOf(ctx.site);
    if (graph !== undefined) {
      for (const file of graph.files.values()) {
        for (const link of file.links) {
          const url = link.href.trim();
          if (link.kind !== "external" || !HTTP_URL.test(url) || !kept(url)) continue;
          add(url, { file: file.file, line: link.line });
        }
      }
    }
    const verdicts = new Map<string, Verdict>();
    await pool([...occurrences.keys()], hostOf, options.concurrency, PER_HOST, async (url) => {
      verdicts.set(url, await probe(url, fetchImpl, options.timeoutMs));
    });

    for (const [url, where] of occurrences) {
      const verdict = verdicts.get(url);
      if (!verdict || verdict.kind === "ok" || verdict.kind === "skipped") continue;
      const problem: Omit<FindingDraft, "location" | "key"> =
        verdict.kind === "broken"
          ? { message: `${url} responds with ${verdict.status}.`, fix: { kind: "manual", summary: verdict.status === 404 || verdict.status === 410 ? "The page is gone. Link to its new address, link to an archived copy, or remove the link." : `Check the address; the server answers ${verdict.status}.` } }
          : verdict.kind === "server-error"
            ? { severity: "warning", message: `${url} responds with ${verdict.status}, a server error that may be temporary.`, fix: { kind: "manual", summary: "Run the check again later. If it keeps failing, replace or remove the link." } }
            : { severity: "warning", message: `${url} could not be reached: ${verdict.reason}.`, fix: { kind: "manual", summary: "Check the address and run again. If the site is gone, replace or remove the link." } };
      for (const location of where) yield { ...problem, location, key: url };
    }
  });
}

export const linksExternal = externalLinksCheck();
