# Verifying pages fetched over HTTP

`seaworthy verify --fetch <url>` verifies pages that are already deployed. Each address you name is
fetched once, written into a temporary folder shaped like a built site, and handed to the same site
graph the folder checks already read (ADR 0011). There is no second pipeline: every check built for
a folder works on a fetched page unchanged.

**The flag is opt-in, and it is the only way Seaworthy touches the network for site content.**
Without it a run is byte-for-byte what it was before: the default `verify` reads the folder on disk
and opens no socket, which `tests/offline.test.ts` and `tests/fixtures.test.ts` enforce. `--network`
is a different flag and does not fetch site pages; it lets the checks that probe links you already
have run.

```bash
npx seaworthy verify --fetch https://example.com/pricing.html --fetch https://example.com/docs/
```

Repeat `--fetch` once per page. Order is the order you give. `report.root` is the origin the pages
came from — `https://example.com` — never a path into a temporary folder.

## What is named, not discovered

Exactly the addresses on the command line are fetched. Nothing is crawled: links on a fetched page
are checked against the pages you named, so a link to a page you did not name is reported as broken
just as it would be on a folder, and a page no one linked to is not missed silently — you can name
it yourself. robots.txt is not consulted, `Crawl-delay` is not honoured, and no sitemap is read.
Discovery is [#308](https://github.com/arminazimi/seaworthy/issues/308) and robots.txt is
[#309](https://github.com/arminazimi/seaworthy/issues/309); both are separate work and neither is
partly here.

## The caps

Every limit is read from `DEFAULT_FETCH_LIMITS` in `packages/verify/src/fetch-site.ts`, and each
number is ADR 0011 §4's default, measured there against a local server:

| Cap | Default | What happens past it |
| --- | --- | --- |
| Pages per run | 500 | The addresses past the cap are refused with a reason and never requested. |
| Response body | 5 MB | A body whose declared `Content-Length` is over the cap is refused without transferring it; one that lies about its length is cut off mid-stream and the stream is cancelled. |
| Redirects per address | 5 | Still redirecting after the fifth hop is refused with a reason. |
| Time per address | 10 s | That address is refused as `gave up after 10 seconds without an answer`; the rest of the run continues. |

The caps are not settable in v0. A config key would mean a new `spec/config` fragment, and the report
contract is frozen; a caller using the module directly (`fetchLiveSite(urls, { limits })`) can raise
or lower each of them today. Raising a cap on a site you do not own means asking that host for more.

## What is refused, and why

A response body is untrusted input (AGENTS.md), so bytes are written to disk and parsed by parse5 and
never executed, evaluated, or followed as code. Before a socket opens, an address is refused when it:

- is not a complete URL, or names no host;
- uses a scheme that is not `http` or `https` (`file:`, `data:`, `javascript:` are all refused, on the
  command line and in a `Location` header);
- carries a user name or a password — Seaworthy never sends credentials;
- points at a private, link-local, or cloud-metadata **address literal** (`10.x`, `172.16-31.x`,
  `192.168.x`, `169.254.x`, `100.64-127.x`, `0.x`, `::`, `fc00::/7`, `fe80::/10`). An address you
  typed as `localhost`, `127.x`, or `::1` is always allowed, because that is your own dev server.
  `--allow-private` allows the rest, for a site that is yours and reachable only from here;
- has a path segment a snapshot cannot hold: a dot-dot, a decoded `%2F` or `%5C`, or a Windows drive
  letter. Writing such a file would put content outside the snapshot. (`%2e%2e` never reaches here —
  the URL parser normalizes it first.)
- would be written onto a file an earlier address already owns: `/a` and `/a?x=1` are one page, not
  two (ADR 0011 §5), so the second is refused rather than overwriting the first.

After a response, it is refused when it answers 400 or above (nothing is written, so links to it are
reported as broken), answers a redirect status this module will not follow, redirects to another host
(recorded, not followed — name the address you want fetched), or serves a non-HTML `Content-Type` at
a name the graph would parse as a page.

Every refusal is reported: one `seaworthy: --fetch refused <url>: <reason>` line per address on
**stderr**, plus a line giving the count (`--fetch got 3 of 5 URLs`), so a machine-parsed report on
stdout is unchanged. Nothing is dropped silently, which is ADR 0011 §6. If not one address became a
page, the run is a usage error (exit 2) instead of a clean report for an empty site.

Flags that only mean a folder on disk are refused under `--fetch` (exit 2): a folder argument,
`--changed`, `--changed-since`, and `--watch`.

## What is never sent

No cookies, no stored credentials (`credentials: "omit"`), no custom headers. The request carries
`accept` and the ADR's user agent, `Seaworthy/<version> (+https://github.com/arminazimi/seaworthy)`.
A `--fetch` run cannot authenticate to a host, so a page behind a login is reported as whatever the
anonymous response is.

## Cancellation

`fetchLiveSite` takes an `AbortSignal` for the run and honours it inside every request, so a
timeout-style caller can cancel mid-body and every address the run had not reached is refused with
`the run was cancelled` rather than vanishing. The CLI has no `--timeout` flag yet, so today nothing
in `verify` aborts a live run: the 10-second-per-address budget is what bounds one, and a whole-run
time budget is #310. A run that is rejected as a usage error asks the host nothing at all — the fetch
happens after every way the invocation itself can be wrong.

Per-address timers and abort listeners are released as soon as that address settles, so no handle
outlives it, and the temporary snapshot is deleted by the run that made it — Seaworthy writes
nowhere else.

## How a fetched page is named in a finding

A finding's `location.file` is the path the URL maps to **inside the snapshot**, using the mapping
ADR 0011 verified: `/` becomes `index.html`, `/docs/` becomes `docs/index.html`, `/about` becomes
`about.html`, and a name with a real extension (`/data.json`) keeps it and is stored as a file rather
than parsed as a page. That is the honest minimum under the frozen v0 report contract, whose
`root` and `file` fields are folder-relative paths; adding URL-shaped locations, or a
`location.url` field, is [#312](https://github.com/arminazimi/seaworthy/issues/312) and belongs with
the schema change, not beside it. So today a live finding reads `pricing.html:12:3`, and `report.root`
tells you which origin that path was relative to. A later run may report the same page as
`https://example.com/pricing.html`.

## Not here

`verify https://example.com` as a command form is
[#311](https://github.com/arminazimi/seaworthy/issues/311); per-host concurrency, retries, refusing a
hostname that *resolves* to a private address, and a whole-run time budget are
[#310](https://github.com/arminazimi/seaworthy/issues/310); URL-rooted reports, schema and SARIF are
[#312](https://github.com/arminazimi/seaworthy/issues/312); preview URLs and live fixtures are
[#315](https://github.com/arminazimi/seaworthy/issues/315) and
[#316](https://github.com/arminazimi/seaworthy/issues/316); the build-folder-vs-deployed comparison is
[#313](https://github.com/arminazimi/seaworthy/issues/313). The `snapshot.json` ADR 0011 §1 pairs with
the crawl is not written either: hosting checks need it, they declare `needs: ["responses"]`, and that
need does not exist in the engine yet. The MCP server and the GitHub Action do not expose `--fetch`; a
tool that fetches arbitrary URLs for an agent is a decision of its own (AGENTS.md), not a flag pass-through.
