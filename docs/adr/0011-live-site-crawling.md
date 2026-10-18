# 0011. Live sites are crawled into a folder snapshot that the existing pipeline verifies

**Status:** Accepted (2026-10-18)

## Context

Phase 5 adds verification of live URLs (`seaworthy verify https://example.com`). The folder pipeline (site graph, checks, report) is built and tested; a live-site mode has to feed it without forking it. Issue #213 asks how pages are discovered and how they enter the site graph, within the limits of robots.txt, politeness, and safety.

Questions:

1. Can a crawl produce something the existing checks read unchanged?
2. How are pages discovered, and what can a crawl never see?
3. What are safe defaults for rate, size, depth, and page count?
4. What can go wrong when an agent hands Seaworthy a URL?

## Method

A throwaway prototype (about 120 lines, not in the repository) with a local test server that behaves like a static host (pretty URLs, directory redirects, 404s) and can add robots.txt, a gzipped sitemap index, redirect loops, and slow responses. The crawler used `fetch` and `parse5`.

- **Equivalence:** crawl three fixtures from `fixtures/` through the server into a temporary folder, run `seaworthy verify` on the original and on the snapshot, and compare the findings.
- **Scenarios:** a 10-page site with a disallowed folder, an orphan page listed only in a gzipped sitemap, query-string variants, a 6 MB page, a redirect loop, and an off-site link.
- **Speed:** a generated 300-page site served locally with 0 and 100 ms of added latency.

## Results

### Equivalence

| Fixture | Pages crawled | Findings from folder | Findings from crawl | Same |
| --- | ---: | ---: | ---: | --- |
| `clean/minimal` | 5 | 0 | 0 | yes |
| `broken/links-internal` | 6 (2 targets answered 404) | 21 | 21 | yes |
| `broken/images` | 6 | 10 | 10 | yes |
| `broken/meta` | 0 | 22 | 0 | **no**: nothing links to its pages |

The snapshot (served path to file: `/docs/` becomes `docs/index.html`, `/about` becomes `about.html`) is a valid input for the folder pipeline. Missing pages (404) are simply absent from the snapshot, so `links.internal` reports the links to them, as on a folder. The one difference is real and expected: **a crawl only sees pages that are linked from the start page or listed in a sitemap.** `broken/meta` has no index page and no links.

### Scenarios

| Case | Observed |
| --- | --- |
| Disallowed folder (`Disallow: /private/`) | not fetched, even though the page is linked and listed in the sitemap |
| Orphan page listed only in a gzipped sitemap behind a sitemap index | found |
| `Allow` longer than `Disallow`, `*`, and `$` patterns | longest match wins; seven path cases correct |
| `/a` and `/a?x=1` | crawled as two pages. Query variants multiply without limit |
| 6 MB page, redirect loop | first run **dropped both silently**; after the fix they are recorded as failures with a reason |
| Redirect to another origin | recorded, not followed |
| `Crawl-delay: 1` in robots.txt | 21 requests took 10 s, which dominates the run |
| Page cap | stops enqueueing; skipped pages are recorded with the reason |

### Speed (301 pages, local server)

| Setup | Time | Pages per second |
| --- | ---: | ---: |
| 1 worker, 0 ms latency | 114 ms | 2,630 |
| 4 workers, 0 ms latency | 101 ms | 2,992 |
| 4 workers, 100 ms latency | 8.8 s | 34 |
| 8 workers, 100 ms latency | 4.7 s | 63 |
| 4 workers, 100 ms latency, 250 ms gap between requests | 75 s | 4 |

The crawler itself costs well under a millisecond per page. Time is latency and politeness. Throughput scales with workers until the politeness gap dominates. A first version of the prototype stopped all but one worker at the start (the queue held one URL), so every concurrency number came out as 1 until that was fixed; the worker loop must wait for in-flight pages, not just for an empty queue.

## Decision

1. **Crawl into a snapshot, then verify the snapshot.** The crawler writes each response to a temporary folder, using the path mapping above, and a `snapshot.json` next to it that records, per URL, the status, final URL, redirect chain, and a few headers (`content-type`, `cache-control`, `content-encoding`, `x-robots-tag`, `link`). Existing checks run unchanged. Hosting checks (Phase 5) declare `needs: ["responses"]` and read `snapshot.json`. No second site graph.
2. **Discovery** starts at the given URL and adds the sitemaps named in robots.txt, `/sitemap.xml`, sitemap indexes (depth 3, including `.gz`), and `href`/`src` of fetched HTML. Only HTML is parsed for links; assets are fetched only when a page references them and are limited by size.
3. **robots.txt is obeyed** for crawling, with `Allow`/`Disallow` by longest match and `*`/`$` patterns. The user agent is `Seaworthy/<version> (+https://github.com/arminazimi/seaworthy)`. Disallowed URLs are listed in the report as notes ("not checked: robots.txt"), never skipped silently. `--ignore-robots` exists for sites the user owns, and the report says it was used. A `Crawl-delay` above 2 seconds stops the run with a note saying so, rather than taking minutes.
4. **Defaults:** 4 workers, 50 ms between requests to one host (0 for `localhost`), 500 pages, 10 s per request, 5 MB per response, 5 redirects, same origin only. Configuration can raise or lower each. At 100 ms latency, 500 pages take about 15 s.
5. **Query strings are not part of page identity** unless the sitemap lists them or the config sets `crawl.keepQuery`. Fragments are always dropped, and ports and host case are normalized.
6. **Every failure is recorded with a reason:** HTTP errors, timeouts, over-size bodies, redirect loops, and off-site redirects. They become findings (`links.internal` for broken links to live pages) or notes, never silent drops.
7. **The report states coverage:** "N pages crawled; pages that are neither linked nor in a sitemap cannot be seen." `--urls <file>` adds known URLs.
8. **Safety for URLs supplied by agents:** private, loopback, link-local, and cloud-metadata addresses are refused unless the URL is `localhost` typed by the user or `--allow-private` is set; the check repeats after every redirect and after DNS resolution. No cookies, credentials, or custom headers are sent. In the MCP server, live crawling is off unless the server is started with it enabled.

## Consequences

- The folder pipeline stays the only pipeline. Every check added for folders works on live sites for free, and every fixture also tests the crawler.
- Live results can differ from folder results by design: a live host adds redirects, headers, and compression, and hides unlinked pages. Hosting checks exist to report those differences.
- Single-page apps return an empty HTML shell, so link discovery and most checks see nothing. Rendered verification (`--rendered`, ADR 0005) will need to take links from the browser's DOM; that is separate work in Phase 5.
- Not covered here: real-internet latency and failures, HTTP/2 behavior, servers that vary content by user agent, and authentication. Each needs its own fixture before launch.
