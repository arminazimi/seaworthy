---
name: seaworthy-agent-ready
description: Make a site agent-ready using the agent-readability score as the scoreboard - work the readability.* check pack to clean (llms.txt, per-page Markdown copies, JSON-LD, robots.txt AI groups, server-rendered content, content signals, and the well-known Agent Skills, API catalog, MCP, and A2A cards), then re-measure. Use when the user asks to make a site agent-ready, raise the readability score, add llms.txt, or let AI tools read the site. Not the general verify-and-fix loop (that is docs/agent-loop.md) and not CI adoption with a baseline and badge.
---

# Make a site agent-ready, one clean check at a time

The agent-readability score is `round(100 × clean checks / applicable checks)` over the
eleven `readability.*` checks. It is **a count, not a quality judgment** — the contract is
[`spec/agent-readability/v1.md`](../../spec/agent-readability/v1.md). Your job is to make
the checks that apply genuinely clean, in the order that helps agents most.

Seaworthy reads built output only and never edits files: every artifact below is authored
in the site's source, then rebuilt.

## Setup (pre-alpha: no npm package yet)

Requires Node.js 22+. Never write `npm i seaworthy`. Either build a checkout
(`git clone https://github.com/arminazimi/seaworthy && cd seaworthy && npm ci && npm run build && npm link -w @seaworthy/verify`)
or pin the site itself: `npm install --save-dev github:arminazimi/seaworthy#<full-commit-SHA>`.
Below, `seaworthy` means whichever launcher you set up; if a flag is rejected, trust `--help`.

## 1. Take the score

```bash
npm run build   # or hugo, astro build, jekyll build, …
seaworthy verify --format json --out readability-before.json
```

No folder argument: the first existing of `dist`, `build`, `out`, `public`, `_site`, `site`.

- `summary.readability` is `{ "score": 50, "checks": 2, "passed": 1, "withFindings": 1 }`.
  Findings are the `readability.*` entries in `findings`, each with a location and a fix hint;
  `--format llm` prints them one per line plus `readability: 50/100 (1 of 2 applicable checks clean)`.
- Every check's rule, example fix, and honesty notes live at `docs/checks/<checkId>.md`.

**Read these rules before chasing the number:**

- A check counts only when it **applies** — its input exists in the site, or it produced a
  finding. `readability.llms-txt` and `readability.ssr-content` apply to any site with pages,
  so a bare site starts at 50/100, not 100: a missing optional file is a note, and a note is
  a finding.
- The denominator **grows when you publish**. A broken `/.well-known/mcp/server-card.json`
  adds one counted check that fails — the score can drop on the way up. Publish an artifact
  only when the service behind it is real, and finish it before re-measuring.
- Skipped checks (network off) are not counted; findings your baseline accepts or a
  suppression hides do not count against a check. The score is computed before the
  `--changed` filter, so run scope never changes it.
- Nothing in this pack ever reaches `error` severity. The default gate (`--fail-on error`)
  cannot fail a readability regression: gate with `--fail-on warning` (broken files) or
  `--fail-on note` (also missing files). The score itself never fails a run — severities do.

## 2. Work the pack in order

Order by what agents actually consume first; one artifact per round.

| Round | Check | Clean means |
| --- | --- | --- |
| 1 | `readability.ssr-content` | page text is in the built HTML, not only after scripts run |
| 2 | `readability.ai-robots` | `robots.txt` AI-crawler groups are consistent, names spelled right, and `llms.txt` is not published while every answering crawler is blocked |
| 2 | `readability.content-signals` | `Content-Signal:` / `Content-Usage:` lines in `robots.txt` parse and use allowed values |
| 3 | `readability.llms-txt` | `/llms.txt` exists: H1 with the site name, one blockquote summary, H2 sections of `- [Title](url): notes` links, every internal link a real page |
| 4 | `readability.md-alternates` | each `<link rel="alternate" type="text/markdown">` resolves to a built `.md` file whose text matches the page |
| 5 | `readability.jsonld` | every `application/ld+json` parses, has `@context`, and known types carry their required fields (`Article`: `headline`, `datePublished`, `author`; dates ISO 8601) |
| 6 | `readability.agent-skills` | `/.well-known/agent-skills/index.json` is valid v0.2.0; skill `url`s are in the site, `digest`s match |
| 6 | `readability.api-catalog` | `/.well-known/api-catalog` is a linkset (RFC 9727) whose links are files in the site |
| 6 | `readability.mcp-card` | a server card with `serverInfo` (name, version) and a transport endpoint — format still a draft |
| 6 | `readability.a2a-card` | `/.well-known/agent-card.json` parses with the A2A-required fields |
| 7 | `readability.markdown-negotiation` | the **deployed** site answers `Accept: text/markdown` with Markdown (see below) |

Round 6 is optional by design: publish a card only if you run that server or agent. Leaving
optional files out costs nothing — they are not counted until they exist.

The `llms.txt` shape, from the check's own fix hint:

```markdown
# Example Docs

> Guides and reference for Example, a tool that does one thing.

## Guides

- [Getting started](/docs/start.md): install and first run
```

## 3. Re-measure and repeat

```bash
npm run build && seaworthy verify --format json --out readability-after.json
seaworthy diff readability-before.json readability-after.json
```

`diff` matches findings by fingerprint, so a fixed finding shows as `fixed` even when edits
moved it. Track `summary.readability.score` and `withFindings` round by round; when
`withFindings` is 0 for the checks that apply, you are done — do not chase 100 by turning
checks off in `seaworthy.config.json`.

Every readability finding is a manual fix: `seaworthy fix --dry-run` prints no diff for
this pack, because the content — which pages matter, what the summary says — only a person
or the site's own source can supply.

## 4. The opt-in deployed check

```bash
seaworthy verify <dir> --network --format llm
```

`readability.markdown-negotiation` asks the live site, home page first plus up to four more
(`pages` option). It needs the deployed address: taken from the home page's absolute
canonical link unless you set it —

```json
{ "checks": { "readability.markdown-negotiation": { "options": { "baseUrl": "https://example.com" } } } }
```

— in `seaworthy.config.json`. Run it only after deploying: unreachable pages become notes
and count against the score. It is the one readability check that touches the network;
every other one, and every other check by default, is fully offline.
