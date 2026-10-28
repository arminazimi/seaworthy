// Reports parallel-agent metrics from the GitHub API: time to merge, conflict rate, and a queue proxy.
// Usage: GH_TOKEN=... node tools/metrics.mjs [--repo owner/name] [--days 90] [--json]
//
// The metric definitions and their limits are in --help:
//   npm run metrics -- --help

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const API = "https://api.github.com";
const DEFAULT_REPO = "arminazimi/seaworthy";
const DEFAULT_DAYS = 90;
const PAGE_SIZE = 100;
const HOUR_MS = 3_600_000;

const HELP = `Usage: npm run metrics -- [options]

Reports three parallel-agent metrics from the GitHub API. Requires a token in
GH_TOKEN or GITHUB_TOKEN.

Options:
  --repo <owner/name>  Repository to measure (default: ${DEFAULT_REPO})
  --days <n>           Window in whole UTC days (default: ${DEFAULT_DAYS})
  --json               Print machine-readable JSON
  --help               Show this help

Metrics:
  time to merge   Median and p90 of merged_at - created_at in hours, rounded
                  to 0.1 h, over pull requests created and merged in the
                  window. Closed pull requests are read newest-updated first
                  and pages stop at the first one updated before the window.
                  Unmerged pull requests and ones created before the window are
                  ignored. Median averages the two middle values; p90 is the
                  nearest-rank value, the ceil(0.9 * n)-th smallest.
  conflict rate   Pull requests created in the window that currently carry the
                  'conflict' label, divided by all pull requests created in the
                  window, from the GitHub search API. It counts current labels,
                  not historical conflicts: GitHub exposes no conflict history.
  queue length    A proxy, not the real merge queue: open pull requests whose
                  detail reports mergeable: true. The list endpoint omits
                  mergeable, so each open pull request is fetched individually;
                  null (still computing) is reported as unknown. The true merge
                  queue requires #477 and is not queried.

The window starts at 00:00 UTC of the day n days before today, so the REST and
search metrics share one boundary.

Examples:
  GH_TOKEN=... npm run metrics
  GH_TOKEN=... npm run metrics -- --days 30 --json
`;

/** The first instant of the window: 00:00 UTC, `days` days before `now`. */
export function windowStart(now, days) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - days);
  return start;
}

/** The middle value, or the mean of the two middle values when the count is even. */
export function median(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The nearest-rank percentile: the ceil(p/100 * n)-th smallest value. */
export function percentile(values, p) {
  if (values.length === 0) return undefined;
  if (!(p > 0 && p <= 100)) throw new Error(`percentile must be in (0, 100], got ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((p * sorted.length) / 100) - 1];
}

/** The URL of the `rel="next"` page in a GitHub Link header, or null. */
export function nextLink(header) {
  if (!header) return null;
  const match = /<([^>]+)>\s*;\s*rel="next"/.exec(header);
  return match ? match[1] : null;
}

/** GH_TOKEN wins over GITHUB_TOKEN; whitespace does not count as a token. */
export function resolveToken(env = process.env) {
  const token = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error("missing token: set GH_TOKEN or GITHUB_TOKEN");
  return token;
}

/** Parses and validates the CLI flags; throws on bad input. */
export function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: "string" },
      days: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) return { help: true };
  const repo = values.repo ?? DEFAULT_REPO;
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error(`--repo must be owner/name, got ${JSON.stringify(repo)}`);
  const days = values.days === undefined ? DEFAULT_DAYS : Number(values.days);
  if (!Number.isInteger(days) || days <= 0) throw new Error(`--days must be a positive whole number, got ${JSON.stringify(values.days)}`);
  return { help: false, repo, days, json: values.json };
}

/** The share of created pull requests that carry the conflict label, or null when none were created. */
export function conflictRate(withConflictLabel, created) {
  if (created === 0) return null;
  return Math.round((withConflictLabel / created) * 10_000) / 10_000;
}

const round1 = (value) => Math.round(value * 10) / 10;

/** Median and p90 time to merge, in hours, over pull requests created and merged in the window. */
export function timeToMerge(pulls, since) {
  const durations = [];
  for (const pull of pulls) {
    if (!pull.merged_at) continue;
    const created = Date.parse(pull.created_at);
    const merged = Date.parse(pull.merged_at);
    if (!(created >= since.getTime()) || !(merged >= since.getTime())) continue;
    durations.push((merged - created) / HOUR_MS);
  }
  if (durations.length === 0) return { prs: 0, medianHours: null, p90Hours: null };
  return {
    prs: durations.length,
    medianHours: round1(median(durations)),
    p90Hours: round1(percentile(durations, 90)),
  };
}

/** The count in a search API response; rejects payloads that are not counts. */
export function parseSearchCount(payload) {
  const count = payload?.total_count;
  if (!Number.isInteger(count) || count < 0) throw new Error("GitHub search response has no valid total_count");
  return count;
}

/** Counts mergeable: true, and reports null/undefined (GitHub still computing) as unknown. */
export function countMergeable(pulls) {
  let mergeable = 0;
  let unknown = 0;
  for (const pull of pulls) {
    if (pull.mergeable === true) mergeable++;
    else if (pull.mergeable === null || pull.mergeable === undefined) unknown++;
  }
  return { openPrs: pulls.length, mergeable, unknownMergeable: unknown };
}

const encodeRepo = (repo) => repo.split("/").map(encodeURIComponent).join("/");

const closedUrl = (repo) => `${API}/repos/${encodeRepo(repo)}/pulls?state=closed&sort=updated&direction=desc&per_page=${PAGE_SIZE}`;
const openUrl = (repo) => `${API}/repos/${encodeRepo(repo)}/pulls?state=open&per_page=${PAGE_SIZE}`;
const pullUrl = (repo, number) => `${API}/repos/${encodeRepo(repo)}/pulls/${number}`;
const searchUrl = (query) => `${API}/search/issues?${new URLSearchParams({ q: query, per_page: "1" })}`;

function rateLimitHint(response) {
  if (response.status !== 403 && response.status !== 429) return "";
  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = Number(response.headers.get("retry-after"));
  if (response.status !== 429 && remaining !== "0" && !(retryAfter > 0)) return "";
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return ` (rate limit resets at ${new Date(reset * 1000).toISOString()})`;
  if (Number.isFinite(retryAfter) && retryAfter > 0) return ` (retry after ${Math.ceil(retryAfter)}s)`;
  return " (rate limited)";
}

/** A GitHub client whose fetch can be swapped in tests. */
export function createClient({ token, fetchImpl = fetch }) {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "seaworthy-metrics",
    "x-github-api-version": "2022-11-28",
  };
  async function get(url) {
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      const message = typeof body?.message === "string" ? body.message : response.statusText || "request failed";
      throw new Error(`GitHub API ${response.status} for ${url}: ${message}${rateLimitHint(response)}`);
    }
    return { data: await response.json(), next: nextLink(response.headers.get("link")) };
  }
  return { get };
}

async function closedPullRequests(client, repo, since) {
  const pulls = [];
  let url = closedUrl(repo);
  while (url) {
    const { data, next } = await client.get(url);
    if (!Array.isArray(data)) throw new Error(`GitHub API returned an unexpected payload for ${url}`);
    for (const pull of data) {
      if (Date.parse(pull.updated_at) < since.getTime()) return pulls;
      pulls.push(pull);
    }
    url = next;
  }
  return pulls;
}

async function openPullRequests(client, repo) {
  const pulls = [];
  let url = openUrl(repo);
  while (url) {
    const { data, next } = await client.get(url);
    if (!Array.isArray(data)) throw new Error(`GitHub API returned an unexpected payload for ${url}`);
    pulls.push(...data);
    url = next;
  }
  return pulls;
}

/** Fetches everything three metrics need. `now` is injectable so tests stay deterministic. */
export async function collectMetrics({ repo, days, token, fetchImpl = fetch, now = new Date() }) {
  const client = createClient({ token, fetchImpl });
  const since = windowStart(now, days);
  const sinceDate = since.toISOString().slice(0, 10);

  const closed = await closedPullRequests(client, repo, since);
  const merged = timeToMerge(closed, since);

  const baseQuery = `repo:${repo} is:pr created:>=${sinceDate}`;
  const withConflictLabel = parseSearchCount((await client.get(searchUrl(`${baseQuery} label:conflict`))).data);
  const created = parseSearchCount((await client.get(searchUrl(baseQuery))).data);

  const open = await openPullRequests(client, repo);
  const details = [];
  for (const pull of open) {
    const { data } = await client.get(pullUrl(repo, pull.number));
    details.push({ mergeable: data.mergeable });
  }
  const queue = countMergeable(details);

  return {
    repo,
    window: { days, since: since.toISOString() },
    timeToMerge: merged,
    conflictRate: {
      prs: created,
      withConflictLabel,
      rate: conflictRate(withConflictLabel, created),
      note: "counts current labels, not historical conflicts; GitHub exposes no conflict history",
    },
    queueLength: {
      openPrs: queue.openPrs,
      mergeable: queue.mergeable,
      unknownMergeable: queue.unknownMergeable,
      proxy: true,
      note: "proxy: open pull requests GitHub reports as mergeable; the true merge queue requires #477 and is not queried",
    },
  };
}

const formatHours = (value) => `${value.toFixed(1)} h`;
const formatPercent = (rate) => `${(rate * 100).toFixed(1)}%`;

/** Deterministic human-readable output. */
export function formatText(summary) {
  const { repo, window, timeToMerge: time, conflictRate: conflict, queueLength: queue } = summary;
  const lines = [
    `repo:   ${repo}`,
    `window: last ${window.days} days, since ${window.since} (UTC)`,
    "",
  ];
  if (time.prs === 0) {
    lines.push("time to merge: no pull requests were created and merged in the window");
  } else {
    lines.push(`time to merge: ${time.prs} pull requests created and merged in the window; median ${formatHours(time.medianHours)}, p90 ${formatHours(time.p90Hours)}`);
  }
  if (conflict.prs === 0) {
    lines.push("conflict rate: n/a (no pull requests created in the window)");
  } else {
    lines.push(`conflict rate: ${conflict.withConflictLabel} of ${conflict.prs} pull requests created in the window carry the conflict label (${formatPercent(conflict.rate)})`);
  }
  lines.push("  counts current labels, not historical conflicts; GitHub exposes no conflict history");
  if (queue.openPrs === 0) {
    lines.push("queue length: 0 open pull requests (proxy; the true merge queue requires #477 and is not queried)");
  } else {
    lines.push(`queue length: ${queue.mergeable} of ${queue.openPrs} open pull requests are mergeable (proxy; ${queue.unknownMergeable} unknown; the true merge queue requires #477 and is not queried)`);
  }
  return lines.join("\n");
}

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`metrics: ${error.message}\n\nRun \`npm run metrics -- --help\` for usage.`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(HELP.trimEnd());
    return;
  }
  try {
    const token = resolveToken();
    const summary = await collectMetrics({ repo: options.repo, days: options.days, token });
    console.log(options.json ? JSON.stringify(summary, null, 2) : formatText(summary));
  } catch (error) {
    console.error(`metrics: ${error.message}`);
    process.exitCode = 1;
  }
}

// Run only when executed directly, not when imported by tests.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) await main();
