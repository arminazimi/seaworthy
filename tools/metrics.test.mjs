import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectMetrics,
  conflictRate,
  countMergeable,
  createClient,
  formatText,
  median,
  nextLink,
  parseOptions,
  parseSearchCount,
  percentile,
  resolveToken,
  timeToMerge,
  windowStart,
} from "./metrics.mjs";

function response(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    headers: new Headers(headers),
    json: async () => body,
  };
}

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    for (const [matches, respond] of routes) {
      if (matches(url)) return typeof respond === "function" ? respond(url) : respond;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls };
}

test("median handles odd and even counts without reordering its input", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), undefined);
  const values = [3, 1, 2];
  median(values);
  assert.deepEqual(values, [3, 1, 2]);
});

test("p90 uses nearest rank", () => {
  assert.equal(percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 90), 9);
  assert.equal(percentile([1, 2, 3, 4], 90), 4);
  assert.equal(percentile([5], 90), 5);
  assert.equal(percentile([], 90), undefined);
});

test("the window starts at midnight UTC, n whole days before today", () => {
  assert.equal(windowStart(new Date("2026-10-28T15:30:00Z"), 90).toISOString(), "2026-07-30T00:00:00.000Z");
  assert.equal(windowStart(new Date("2026-10-28T23:59:59Z"), 1).toISOString(), "2026-10-27T00:00:00.000Z");
});

test("timeToMerge keeps only pull requests created and merged in the window", () => {
  const since = new Date("2026-07-30T00:00:00Z");
  const result = timeToMerge([
    { created_at: "2026-07-01T00:00:00Z", merged_at: "2026-08-01T00:00:00Z" },
    { created_at: "2026-08-01T00:00:00Z", merged_at: null },
    { created_at: "2026-08-02T00:00:00Z", merged_at: "2026-08-02T02:00:00Z" },
    { created_at: "2026-07-31T22:00:00Z", merged_at: "2026-08-01T02:00:00Z" },
  ], since);
  assert.deepEqual(result, { prs: 2, medianHours: 3, p90Hours: 4 });
  assert.deepEqual(timeToMerge([], since), { prs: 0, medianHours: null, p90Hours: null });
});

test("nextLink finds rel=next and ignores other links", () => {
  const header = '<https://api.github.com/repos/a/b/pulls?page=2>; rel="next", <https://api.github.com/repos/a/b/pulls?page=5>; rel="last"';
  assert.equal(nextLink(header), "https://api.github.com/repos/a/b/pulls?page=2");
  assert.equal(nextLink('<https://api.github.com/repos/a/b/pulls?page=5>; rel="last"'), null);
  assert.equal(nextLink(undefined), null);
});

test("parseSearchCount reads total_count and rejects bad payloads", () => {
  assert.equal(parseSearchCount({ total_count: 42, incomplete_results: false, items: [] }), 42);
  assert.equal(parseSearchCount({ total_count: 0 }), 0);
  assert.throws(() => parseSearchCount({}), /total_count/);
  assert.throws(() => parseSearchCount({ total_count: -1 }), /total_count/);
  assert.throws(() => parseSearchCount({ total_count: "3" }), /total_count/);
});

test("countMergeable counts true and reports null as unknown", () => {
  assert.deepEqual(
    countMergeable([{ mergeable: true }, { mergeable: null }, { mergeable: false }, { mergeable: true }]),
    { openPrs: 4, mergeable: 2, unknownMergeable: 1 },
  );
  assert.deepEqual(countMergeable([]), { openPrs: 0, mergeable: 0, unknownMergeable: 0 });
});

test("conflictRate is null when no pull requests were created in the window", () => {
  assert.equal(conflictRate(0, 0), null);
  assert.equal(conflictRate(3, 40), 0.075);
});

test("parseOptions applies defaults and reads flags", () => {
  assert.deepEqual(parseOptions([]), { help: false, repo: "arminazimi/seaworthy", days: 90, json: false });
  assert.deepEqual(parseOptions(["--repo", "a/b", "--days", "7", "--json"]), { help: false, repo: "a/b", days: 7, json: true });
  assert.deepEqual(parseOptions(["--help"]), { help: true });
});

test("parseOptions rejects bad arguments", () => {
  assert.throws(() => parseOptions(["--days", "0"]), /--days/);
  assert.throws(() => parseOptions(["--days", "1.5"]), /--days/);
  assert.throws(() => parseOptions(["--days", "nope"]), /--days/);
  assert.throws(() => parseOptions(["--repo", "nope"]), /--repo/);
  assert.throws(() => parseOptions(["--repo", "a/b/c"]), /--repo/);
  assert.throws(() => parseOptions(["--bogus"]), /Unknown option/);
  assert.throws(() => parseOptions(["extra"]), /Unexpected argument/);
});

test("resolveToken prefers GH_TOKEN and rejects a missing token", () => {
  assert.equal(resolveToken({ GH_TOKEN: "gh", GITHUB_TOKEN: "actions" }), "gh");
  assert.equal(resolveToken({ GITHUB_TOKEN: "actions" }), "actions");
  assert.equal(resolveToken({ GH_TOKEN: "  ", GITHUB_TOKEN: "actions" }), "actions");
  assert.throws(() => resolveToken({}), /set GH_TOKEN or GITHUB_TOKEN/);
});

test("API failures carry the status, GitHub message, and rate-limit reset", async () => {
  const { fetchImpl } = fakeFetch([
    [() => true, response({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-reset": "1760000000", "x-ratelimit-remaining": "0" } })],
  ]);
  const client = createClient({ token: "test", fetchImpl });
  await assert.rejects(
    () => client.get("https://api.github.com/repos/a/b/pulls"),
    /GitHub API 403 for https:\/\/api\.github\.com\/repos\/a\/b\/pulls: API rate limit exceeded \(rate limit resets at 2025-10-09T08:53:20\.000Z\)/,
  );
});

test("a permission failure is not reported as a rate limit", async () => {
  const { fetchImpl } = fakeFetch([
    [() => true, response({ message: "Resource not accessible by integration" }, { status: 403, headers: { "x-ratelimit-reset": "1760000000", "x-ratelimit-remaining": "42" } })],
  ]);
  const client = createClient({ token: "test", fetchImpl });
  await assert.rejects(
    () => client.get("https://api.github.com/repos/a/b/pulls"),
    /GitHub API 403 .*: Resource not accessible by integration$/,
  );
});

test("collectMetrics combines closed, search, and open pull request data", async () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const closedFirst = "https://api.github.com/repos/arminazimi/seaworthy/pulls?state=closed&sort=updated&direction=desc&per_page=100";
  const closedSecond = `${closedFirst}&page=2`;
  const openFirst = "https://api.github.com/repos/arminazimi/seaworthy/pulls?state=open&per_page=100";
  const openSecond = `${openFirst}&page=2`;
  const query = (url) => new URL(url).searchParams.get("q");

  const { fetchImpl, calls } = fakeFetch([
    [(url) => url === closedFirst, response([
      { number: 1, created_at: "2026-08-01T00:00:00Z", merged_at: "2026-08-01T02:00:00Z", updated_at: "2026-08-01T02:00:00Z" },
      { number: 2, created_at: "2026-08-03T00:00:00Z", merged_at: "2026-08-03T06:00:00Z", updated_at: "2026-08-03T06:00:00Z" },
    ], { headers: { link: `<${closedSecond}>; rel="next"` } })],
    [(url) => url === closedSecond, response([
      { number: 3, created_at: "2026-07-01T00:00:00Z", merged_at: "2026-07-02T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
      { number: 4, created_at: "2026-08-04T00:00:00Z", merged_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:00Z" },
    ])],
    [(url) => url.startsWith("https://api.github.com/search/issues?") && query(url).includes("label:conflict"), response({ total_count: 2, incomplete_results: false, items: [] })],
    [(url) => url.startsWith("https://api.github.com/search/issues?"), response({ total_count: 8, incomplete_results: false, items: [] })],
    [(url) => url === openFirst, response([{ number: 10 }, { number: 11 }], { headers: { link: `<${openSecond}>; rel="next"` } })],
    [(url) => url === openSecond, response([{ number: 12 }])],
    [(url) => url.endsWith("/pulls/10"), response({ number: 10, mergeable: true })],
    [(url) => url.endsWith("/pulls/11"), response({ number: 11, mergeable: null })],
    [(url) => url.endsWith("/pulls/12"), response({ number: 12, mergeable: false })],
  ]);

  const summary = await collectMetrics({ repo: "arminazimi/seaworthy", days: 90, token: "test", fetchImpl, now });

  assert.equal(summary.window.since, "2026-07-30T00:00:00.000Z");
  assert.deepEqual(summary.timeToMerge, { prs: 2, medianHours: 4, p90Hours: 6 });
  assert.equal(summary.conflictRate.prs, 8);
  assert.equal(summary.conflictRate.withConflictLabel, 2);
  assert.equal(summary.conflictRate.rate, 0.25);
  assert.match(summary.conflictRate.note, /current labels/);
  const { note, ...queue } = summary.queueLength;
  assert.deepEqual(queue, { openPrs: 3, mergeable: 1, unknownMergeable: 1, proxy: true });
  assert.match(note, /#477/);
  assert.ok(calls.some((url) => url === closedSecond), "closed pagination must follow the Link header");
  assert.ok(calls.some((url) => url === openSecond), "open pagination must follow the Link header");
  assert.ok(calls.some((url) => url.endsWith("/pulls/10")), "each open pull request detail is fetched for mergeable");
  assert.ok(!calls.some((url) => url.includes("page=3")));
  assert.doesNotMatch(formatText(summary), /NaN|Infinity/);
});

test("collectMetrics reports nulls and zero when the window is empty", async () => {
  const { fetchImpl } = fakeFetch([
    [(url) => url.includes("state=closed"), response([])],
    [(url) => url.includes("/search/issues"), response({ total_count: 0 })],
    [(url) => url.includes("state=open"), response([])],
  ]);
  const summary = await collectMetrics({ repo: "a/b", days: 30, token: "test", fetchImpl, now: new Date("2026-10-28T00:00:00Z") });

  assert.deepEqual(summary.timeToMerge, { prs: 0, medianHours: null, p90Hours: null });
  assert.equal(summary.conflictRate.rate, null);
  assert.deepEqual(
    { openPrs: summary.queueLength.openPrs, mergeable: summary.queueLength.mergeable, unknownMergeable: summary.queueLength.unknownMergeable },
    { openPrs: 0, mergeable: 0, unknownMergeable: 0 },
  );
  const text = formatText(summary);
  assert.match(text, /time to merge: no pull requests/);
  assert.match(text, /conflict rate: n\/a/);
  assert.match(text, /queue length: 0 open pull requests/);
  assert.doesNotMatch(text, /NaN|Infinity/);
});
