// live fetch: the pages a person names, pulled over HTTP into the site graph the file-based
// checks already read (ADR 0011, issue #307). Nothing here runs unless a caller names URLs —
// a default verify stays offline, and `tests/offline.test.ts` proves it.
//
// The shape comes from ADR 0011, not from a new design:
//   - **Snapshot, then verify.** Each response is written to a temporary folder under the path
//     mapping the ADR measured (`/docs/` becomes `docs/index.html`, `/about` becomes
//     `about.html`) and that folder is handed to `buildSite`. There is no second site graph, so
//     every check built for a folder works on fetched pages unchanged, and a page that answered
//     404 is simply absent from it — like a file a build never wrote.
//   - **A response body is untrusted input** (AGENTS.md): bytes go to disk and parse5 reads them.
//     Nothing fetched is ever evaluated or executed, and no response is followed as code.
//   - **Bound everything** (ADR 0011 §4, §8): the caps below are the ADR's defaults; redirects are
//     followed by hand and only inside the host that was named; an over-size body is cut off and
//     refused; no cookies, credentials, or custom headers are sent; and a private or link-local
//     address literal is refused unless the caller says the site is reachable only from here.
//
// Deliberately not here: discovery from links and sitemaps (#308), robots.txt and `Crawl-delay`
// (#309), per-host concurrency, retries, refusing a hostname that resolves to a private address,
// and a total time budget (#310), the `verify <url>` command (#311), and URL-shaped locations in
// the report (#312). The URLs fetched are exactly the ones the caller names, in that order.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type SiteGraph, buildSite } from "./site.js";
import { VERSION } from "./version.js";

/** The caps one fetch run applies. A caller may raise or lower each of them. */
export interface FetchLimits {
  /** Fetch at most this many URLs; the rest are refused with a reason, never fetched anyway. */
  maxPages: number;
  /** Refuse a response body larger than this many bytes, without reading the rest of it. */
  maxBytes: number;
  /** Follow at most this many redirects for one URL. */
  maxRedirects: number;
  /** Wall time one URL may take, headers and body together. */
  timeoutMs: number;
}

/** ADR 0011 §4: 500 pages, 5 MB per response, 5 redirects, 10 s per request. */
export const DEFAULT_FETCH_LIMITS: FetchLimits = { maxPages: 500, maxBytes: 5_000_000, maxRedirects: 5, timeoutMs: 10_000 };

/** How Seaworthy identifies itself (ADR 0011 §3). No cookies and no credentials ride along. */
export const LIVE_USER_AGENT = `Seaworthy/${VERSION} (+https://github.com/arminazimi/seaworthy)`;

/** One URL that was fetched and written into the snapshot. */
export interface FetchedUrl {
  /** The address as the caller named it. */
  readonly url: string;
  /** Where it actually came from, after the redirects this module was willing to follow. */
  readonly finalUrl: string;
  /** Snapshot-relative path, forward slashes: what a finding's `location.file` says. */
  readonly file: string;
  readonly status: number;
  readonly contentType: string;
  readonly bytes: number;
  /** True when the snapshot holds it as HTML, so the site graph parses it into a page. */
  readonly isPage: boolean;
}

/** One URL this module would not or could not turn into a file, with its reason (ADR 0011 §6). */
export interface RefusedUrl {
  readonly url: string;
  readonly reason: string;
}

export interface LiveSite {
  /** The temporary folder holding the snapshot: a built-site folder like any other, and nothing else. */
  readonly folder: string;
  /** The origin the snapshot came from, for labelling the run. Never an absolute path. */
  readonly origin: string;
  /** The graph every file-based check reads. */
  readonly site: SiteGraph;
  readonly fetched: readonly FetchedUrl[];
  readonly refused: readonly RefusedUrl[];
  /** Deletes the snapshot. The caller owns the folder; Seaworthy writes nowhere else (AGENTS.md). */
  remove(): void;
}

export interface FetchSiteOptions {
  /** Cancellation: `--timeout`-style callers abort it, and every remaining URL is refused with a reason. */
  readonly signal?: AbortSignal;
  readonly limits?: Partial<FetchLimits>;
  /** Fetch private and link-local address literals too (ADR 0011 §8). */
  readonly allowPrivate?: boolean;
}

const HTML_NAME = /\.html?$/i;
/** A last segment with a real extension is served as itself; one without is a page, so it gets `.html`. */
const HAS_EXTENSION = /\.[a-z][a-z0-9]{0,7}$/i;
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 305, 307, 308]);
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The host of a URL, bracket-free and lowercased, so `LOCALHOST` and `[::1]` compare cleanly. */
function hostOf(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Whether an address literal points at a machine on this network. Loopback is allowed, because a
 * person who types `localhost` means their own server (ADR 0011 §8). A hostname is not classified
 * here: refusing a name that *resolves* to a private address costs a DNS lookup per URL, and that
 * is the network work #310 owns.
 */
function addressClass(host: string): "loopback" | "private" | "public" {
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  const v4 = IPV4.exec(host);
  if (v4 !== null) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127) return "loopback";
    if (a === 0 || a === 10 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "private";
    return "public";
  }
  if (host.includes(":")) {
    if (host === "::1") return "loopback";
    if (host === "::") return "private";
    if (/^f[cd]/i.test(host)) return "private"; // fc00::/7 unique-local
    if (/^fe[89ab]/i.test(host)) return "private"; // fe80::/10 link-local, where cloud metadata addresses live
    return "public";
  }
  return "public";
}

/**
 * The file a static host serves this URL from, in the mapping ADR 0011 verified against the
 * fixtures: `/` becomes `index.html`, a directory URL gets `index.html` appended, an
 * extension-less path gets `.html`, and anything else keeps its own path. A segment that is not a
 * plain name — a dot-dot, a decoded `%2F`, a Windows drive — is refused rather than guessed at,
 * because writing it would put a file outside the snapshot.
 */
function snapshotFileFor(url: URL): { file: string } | { reason: string } {
  const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return { file: "index.html" };
  for (const segment of segments) {
    const name = decode(segment);
    if (name === "." || name === ".." || name === "" || name.includes("/") || name.includes("\\") || name.includes("\0") || /^[a-zA-Z]:/.test(name))
      return { reason: `has the path segment ${JSON.stringify(segment)}, which is not a file name a snapshot can hold` };
  }
  const last = segments[segments.length - 1] as string;
  const file = segments.map(decode).join("/");
  return { file: HAS_EXTENSION.test(last) ? file : `${file}.html` };
}

/** The scheme, credentials, host, and path checks that run before a single socket opens. */
function targetFor(raw: string, allowPrivate: boolean | undefined): { url: URL; file: string } | { reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { reason: "is not a complete URL; name one page, such as https://example.com/pricing.html" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { reason: `uses the ${url.protocol.slice(0, -1)} scheme, and only http and https are fetched` };
  if (url.username !== "" || url.password !== "") return { reason: "names a user or a password; Seaworthy never sends credentials" };
  const host = hostOf(url);
  if (host === "") return { reason: "names no host" };
  if (allowPrivate !== true && addressClass(host) === "private")
    return { reason: `points at ${host}, a private or link-local address, so it was refused rather than requested. Pass --allow-private when the site is yours and reachable only from here` };
  const file = snapshotFileFor(url);
  return "reason" in file ? file : { url, file: file.file };
}

/** One URL's HTTP exchange, with the per-request timers and listeners released once its body is settled. */
type Exchange = { kind: "response"; response: Response; finalUrl: string; release: () => void } | { kind: "refused"; reason: string };

/**
 * Reads a body no further than the cap. The declared length is honoured first, so an over-size
 * response is refused without transferring it; a body that lies about its length is cut off while
 * it streams. Either way the stream is cancelled, so no socket is left half-read.
 */
async function readBody(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array } | { reason: string }> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    // The body is dropped, not left half-read: an unread stream would keep its socket owned.
    await response.body?.cancel().catch(() => {});
    return { reason: `responds with ${declared} bytes, over the ${maxBytes}-byte cap` };
  }
  if (response.body === null) return { bytes: new Uint8Array(0) };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done === true) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { reason: `sends more than ${maxBytes} bytes, and the cap stopped the transfer at ${total}` };
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    return { reason: `the body did not arrive: ${error instanceof Error ? error.message : String(error)}` };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

/**
 * Fetches one URL and follows its redirects by hand, so every hop is bounded in number, in host,
 * and in scheme, and the address policy repeats on each of them (ADR 0011 §8).
 */
async function exchange(raw: string, limits: FetchLimits, allowPrivate: boolean | undefined, signal: AbortSignal | undefined): Promise<Exchange> {
  let current = raw.trim();
  // A function, not a read: `aborted` flips while this loop is between awaits, so narrowing it
  // once would be wrong.
  const aborted = (): boolean => signal?.aborted === true;
  for (let hop = 0; ; hop++) {
    if (aborted()) return { kind: "refused", reason: "the run was cancelled before this request" };
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("no answer in time", "TimeoutError")), limits.timeoutMs);
    timer.unref?.();
    const release = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        // No cookie jar and no stored credentials: nothing here can authenticate to the host.
        credentials: "omit",
        signal: controller.signal,
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "user-agent": LIVE_USER_AGENT },
      });
    } catch (error) {
      release();
      const cancelled = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error);
      if (!cancelled) return { kind: "refused", reason: `could not be reached: ${cause}` };
      return { kind: "refused", reason: aborted() ? "the run was cancelled" : `gave up after ${limits.timeoutMs / 1000} seconds without an answer` };
    }
    if (!REDIRECT_STATUSES.has(response.status)) return { kind: "response", response, finalUrl: current, release };

    // A redirect this module will not serve still carries a body; drop it before moving on.
    await response.body?.cancel().catch(() => {});
    release();
    const location = response.headers.get("location");
    if (location === null || location.trim() === "") return { kind: "refused", reason: `answers ${response.status} with no Location header` };
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { kind: "refused", reason: `redirects to ${JSON.stringify(location)}, which is not a URL` };
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") return { kind: "refused", reason: `redirects to the ${next.protocol.slice(0, -1)} scheme, which is not fetched` };
    if (next.username !== "" || next.password !== "") return { kind: "refused", reason: "redirects to an address that names a user or a password; Seaworthy never sends credentials" };
    if (allowPrivate !== true && addressClass(hostOf(next)) === "private") return { kind: "refused", reason: `redirects to ${hostOf(next)}, a private or link-local address; pass --allow-private if that is your own site` };
    // Same host, or stop: a cross-host hop is recorded, never followed (ADR 0011, measured as
    // "redirect to another origin: recorded, not followed"). The scheme may change, because
    // http -> https on one host is the ordinary case.
    if (hostOf(next) !== hostOf(new URL(current))) return { kind: "refused", reason: `redirects to ${next.origin} on another host, so it was recorded and not followed. Name the address you want fetched.` };
    if (hop >= limits.maxRedirects) return { kind: "refused", reason: `is still redirecting after ${limits.maxRedirects} redirects` };
    current = next.href;
  }
}

/**
 * Fetches the named URLs into a temporary folder and returns the site graph built from it. The
 * caller owns that folder and must call `remove()`; the fetch itself writes nowhere else.
 */
export async function fetchLiveSite(urls: readonly string[], options: FetchSiteOptions = {}): Promise<LiveSite> {
  const limits: FetchLimits = { ...DEFAULT_FETCH_LIMITS, ...options.limits };
  const folder = mkdtempSync(join(tmpdir(), "seaworthy-live-"));
  const fetched: FetchedUrl[] = [];
  const refused: RefusedUrl[] = [];
  const ownerOfFile = new Map<string, string>();

  for (const [index, raw] of urls.entries()) {
    const name = raw.trim();
    if (options.signal?.aborted === true) {
      refused.push({ url: name, reason: "the run was cancelled before this URL was fetched" });
      continue;
    }
    if (index >= limits.maxPages) {
      refused.push({ url: name, reason: `is past the page cap of ${limits.maxPages}, so it was never requested` });
      continue;
    }
    const target = targetFor(name, options.allowPrivate);
    if ("reason" in target) {
      refused.push({ url: name, reason: target.reason });
      continue;
    }
    // The request sent is the one the caller named, query string and all; two addresses whose file
    // would be the same (`/a` and `/a?v=2`, ADR 0011 §5) are one page, so the second is refused
    // before a second request rather than silently overwriting what the first wrote.
    const occupant = ownerOfFile.get(target.file);
    if (occupant !== undefined) {
      refused.push({ url: name, reason: `would be written to ${target.file}, which ${occupant} already occupies in the snapshot, so it is one page, not two` });
      continue;
    }

    const result = await exchange(name, limits, options.allowPrivate, options.signal);
    if (result.kind === "refused") {
      refused.push({ url: name, reason: result.reason });
      continue;
    }
    try {
      const status = result.response.status;
      const contentType = (result.response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      const isPage = HTML_NAME.test(target.file);
      if (status >= 400) {
        await result.response.body?.cancel().catch(() => {});
        refused.push({ url: name, reason: `answers ${status}${result.finalUrl === name ? "" : ` at ${result.finalUrl}`}. Nothing was written, so links to it are reported as broken.` });
        continue;
      }
      if (status >= 300) {
        await result.response.body?.cancel().catch(() => {});
        refused.push({ url: name, reason: `answers ${status}, a redirect this module does not follow` });
        continue;
      }
      if (isPage && !HTML_TYPES.has(contentType)) {
        await result.response.body?.cancel().catch(() => {});
        refused.push({ url: name, reason: `responds with ${contentType === "" ? "no Content-Type" : contentType}, not HTML, so ${target.file} would not be a page` });
        continue;
      }
      const body = await readBody(result.response, limits.maxBytes);
      if ("reason" in body) {
        refused.push({ url: name, reason: body.reason });
        continue;
      }
      const filePath = join(folder, ...target.file.split("/"));
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, body.bytes);
      ownerOfFile.set(target.file, name);
      fetched.push({ url: name, finalUrl: result.finalUrl, file: target.file, status, contentType, bytes: body.bytes.byteLength, isPage });
    } finally {
      result.release();
    }
  }

  return {
    folder,
    origin: originOf(urls, options.allowPrivate),
    site: buildSite(folder),
    fetched,
    refused,
    remove: () => rmSync(folder, { recursive: true, force: true }),
  };
}

/** The origin a live run is labelled by: the first named address that is a valid http(s) URL. */
function originOf(urls: readonly string[], allowPrivate: boolean | undefined): string {
  for (const raw of urls) {
    const target = targetFor(raw, allowPrivate);
    if ("url" in target) return target.url.origin;
  }
  return "live site";
}

/**
 * What a live run says about itself on stderr: one line per URL it would not or could not fetch,
 * and the count that explains why a page has no findings. Never on stdout, so a machine format
 * keeps exactly the bytes it would have made from a folder.
 */
export function fetchNotes(live: LiveSite): string {
  const lines = live.refused.map((refusal) => `seaworthy: --fetch refused ${refusal.url}: ${refusal.reason}`);
  if (live.refused.length > 0) lines.push(`seaworthy: --fetch got ${live.fetched.length} of ${live.fetched.length + live.refused.length} URLs; a page it did not get was not checked.`);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
