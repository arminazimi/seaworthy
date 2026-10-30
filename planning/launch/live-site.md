# Live-site verification — launch wave 2 draft (#156)

**This is a draft for review, not a post to send.** Before publishing: re-run every command below
at your publish commit and replace any output that differs; re-fetch the demo page (it belongs to a
third party and can change without notice); keep the disclosure that the demo content was downloaded
from that third-party site on the stated date. Owner: `launch2.posts`. Channel plan:
[`brand/launch-1/channels.md`](../../brand/launch-1/channels.md); claims table:
[`brand/launch-1/facts.md`](../../brand/launch-1/facts.md).

## Format limits

- A full article (dev.to or blog): front matter with title and tags; body Markdown of any length.
  Shorter than the wave-1 dev.to piece — it shows one run, not the whole product story.
- Every command, finding, and number below was executed before this draft was written; nothing is
  paraphrased from memory or from [the loop page](../../docs/agent-loop.md).

## Hook (title)

> Seaworthy on a live site: what one downloaded page already tells an agent (pre-alpha, real run
> inside)

## Body

> **Status up front: pre-alpha.** Nothing is on npm, there is no release version and no tag.
> Everything here runs from a source clone.

Wave 1 checked the build folder — the output of `npm run build`. But sites break in ways that only
exist after deploy: a file the host never got, a base path that only appears under `/blog/`, a page
the world reads that nobody rebuilt. The wave-2 headline is verifying those. It is not built yet:
`seaworthy verify https://example.com` (roadmap key `live.cli`, with the fetch and crawl under it)
is planned work, and this post will not pretend otherwise.

What works today is one command away from that, and honest: fetch what is live into a folder, and
run the same checks on what the world actually receives.

### The run

One real page, chosen because it is public, tiny, and stable: `https://example.com/`, fetched with
`curl` on October 30, 2026 (577 bytes of HTML; the page belongs to a third party and we keep only
what Seaworthy itself produced from it).

```bash
mkdir live && curl -sS -o live/index.html https://example.com/
node packages/verify/dist/src/cli.js verify live
# seaworthy 0.0.0: live (1 page, 88 checks) · exit 1
```

9 findings from that run, excerpted below — check IDs, severities, and locations exactly as the
report printed them (long messages truncated at `…`):

```text
404.html
  -       warning quality.not-found-page  The build has no 404 page, so a broken address shows the host's default error page, and agents reading the site see a soft 404.
index.html
  1:30    warning a11y.landmarks      The page has no <main> landmark. …
  1:30    note    meta.canonical      The page has no canonical link.
  1:30    warning meta.description    The page has no meta description.
  1:30    note    social.open-graph   The page has no Open Graph tags: missing og:title, og:description, og:image.
  1:30    note    social.twitter-card The page has no twitter:card, so X uses its default summary card.
  1:544   error   assets.missing      <script> loads /s.js, which is not in the built site.
  -       warning headings.h1         The page has no h1 heading. …
llms.txt
  -       note    readability.llms-txt    The site has no llms.txt. It is optional; where present, AI tools use it as a short guide to the site's pages.
```

The report header is the whole pitch: one downloaded page, and the engine ran 88 checks on it,
naming severities and locations, with a fix hint and an agent-ready `prompt` per finding — the same
report shape as the build folder, because it is the same engine.

### Read it honestly: the page versus the mirror

Of those 9 findings, one is not a claim about the live site: `assets.missing` says `/s.js` is not
in the folder — true of the mirror, which fetched only the HTML. The live server does serve that
script. The fetched page really has no `<h1>`, no meta description, and no Open Graph tags as of
the fetch date, so those findings stand; the site-level notes (404 page, `llms.txt`) are statements
about a one-page mirror, not the whole domain.

That distinction is the discipline, not a flaw: **you verify exactly what you downloaded**, and the
quality of the mirror is the quality of the verdict. The crawl tasks on the roadmap (`live.fetch`,
`live.crawl`) exist to make the folder BE the deployed site rather than an approximation, and
`live.cli` exists so nobody has to hold the distinction in their head. No dates; the roadmap is a
plan, not a promise.

### Opting into the network

By default a run makes no request. `--network` is opt-in and says so in the report:

```bash
node packages/verify/dist/src/cli.js verify live --network --format llm
# seaworthy llm live: 10 findings in 3 files (1 error, 4 warnings, 5 notes), 1 page, 88 checks
```

The tenth finding, verbatim:

```text
  Set it in seaworthy.config.json: "checks": { "readability.markdown-negotiation": { "options": { "baseUrl": "https://example.com" } } } | readability.markdown-negotiation note | index.html | This check needs the deployed address of the site, and the home page has no absolute canonical link to take it from.
```

It even names the config to set — the deployed address is exactly what a live-site run knows and a
build folder does not. `links.external` ran too; this page's HTML contains no external links, so
it reported nothing. That is also honest.

### What a live run is for

For an agent, the loop does not change: read findings → fix the source → rebuild → redeploy →
mirror → verify. What changes is the ground truth: the checks now see what visitors see. For a
team, mirror-and-verify runs against a preview URL today, from source, before `live.cli` ships.

## Call to action

Repository: https://github.com/arminazimi/seaworthy — pre-alpha, built in public. To wire the CLI
into a project now: `npm install --no-save github:arminazimi/seaworthy#<full-commit-SHA>` after
your own `npm ci` (pin the full SHA; a later `npm ci` removes it). Or from a clone:
`npm ci && npm run build`, then the commands above. Open an issue for any finding you disagree
with; in pre-alpha a false positive is the most valuable bug report there is.

## What you will not find here

No URL mode (`verify https://…` is roadmap, not reality, and this post says so). No hosting checks
(status codes, headers, compression — roadmap `hosting.*`). No claim that one page represents a
whole site. No scores from us; the "agent readability" line is the report's own output, quoted only
where it ran.

## Measurements

Timings measured **October 30, 2026** on macOS 26.6.1, Apple M5, Node v22.23.1, from a built
checkout (`npm run build`) invoking `node packages/verify/dist/src/cli.js verify …` with the mirror
in a scratch folder outside the repository. Wall time (`/usr/bin/time`) for the offline run: 0.06 s
(one page); the `--network` run also finished in 0.06 s wall. Orders of magnitude on an idle
machine, not constants.
