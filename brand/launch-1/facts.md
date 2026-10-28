# Facts

What we may claim, the file that proves it, and the condition under which it is true. A claim that
is not in this table is not made.

## Claims we may make

| Claim | Source of truth | True when |
| --- | --- | --- |
| The product is called Seaworthy | `brand/tokens.json` | Always |
| The tagline is "Ship sites agents can trust." | `brand/tokens.json` | Always |
| The secondary line is "Verified before it sails." | `brand/tokens.json` | Always |
| The descriptor is "Verifies websites for agents." | `brand/tokens.json` | Always |
| The license is Apache-2.0 | `LICENSE` | Always |
| The CLI is `seaworthy`, and `seaworthy verify [dir]` runs the checks | `packages/verify/package.json`, `packages/verify/src/cli.ts` | Always in the repo; after the release for `npx` |
| The npm package is `@seaworthy/verify` | `packages/verify/package.json` | After the release |
| The MCP server is named `seaworthy` | `packages/mcp/src/server.ts` | After the release |
| The GitHub Action is `@seaworthy/action` | `packages/action/package.json` | After the release |
| The report is versioned, with a stable check ID, a location, and a fix hint per finding | `spec/report/v0.schema.json` | Always in the repo; after the release for the published package |
| Every built-in check has a documentation page | `docs/checks/README.md` | Always |
| The badge is a committed SVG, not a hosted endpoint | `docs/badge.md` | Always |
| The checks make no network request unless the run opts in | `AGENTS.md`, the trust rules | Always |
| The repository is `github.com/arminazimi/seaworthy` | `README.md` | Always |
| The status is pre-alpha | `README.md` | Until the README says otherwise |

"After the release" means after `release.publish` in the roadmap: the packages on npm, the MCP
server published, and the Action in the Marketplace. Check the published version before quoting it:
`npm view @seaworthy/verify version`.

## Claims we may not make yet

| Claim | Why not | Available after |
| --- | --- | --- |
| Any accuracy, score, or benchmark number | No published benchmark exists; a number without a method is a liability | `bench.results` |
| "We verified the top 100 docs sites" | The run has not happened, and a post must link the write-up | `launch1.top100` |
| A speed number, such as verifying 1,000 pages in N seconds | Not measured and published | `release.perf` |
| "The only tool that does X", or "no other tool does X" | Claims about other tools are limited to documentation: test the specific tool and link the evidence | [ADR 0007](../../docs/adr/0007-prior-art.md) |
| User counts, star counts, download counts, "trusted by" | No source to point at | Never, unless we publish the source |
| Pricing, or "free forever" | There is no pricing | Never, until there is one |
| Roadmap dates as commitments | The roadmap is a plan, not a promise | Never |
| A fixed screenshot of a broken site | Screenshots must come from a real run | `launch1.demo-repo` |

When a claim is missing from this table, the answer is not a softer version of it. It is no claim.
