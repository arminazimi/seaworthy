# Show HN — launch draft (#129)

**This is a draft for review, not a post to send.** Before publishing: run the commands below
yourself at the commit you pin and confirm every number and finding matches real output; check
where the repository link lands; if you paste a screenshot, crop the version line (a dev build
prints `seaworthy 0.0.0`, and there is no released version to quote). Owner: `launch1.posts`.
The channel plan is [`brand/launch-1/channels.md`](../../brand/launch-1/channels.md); claims come
from [`brand/launch-1/facts.md`](../../brand/launch-1/facts.md).

## Format limits

- One title line, then the post body; on Hacker News the body is a self-comment posted right after
  the link. The kit sets no character count for HN, so the constraint is in words: the title must
  survive as a single line in the list, and the body should stay short enough to read without
  clicking.
- Show HN requires the maker to be present in the comments; the first comment is yours, so the
  post stays factual and the discussion carries the rest.

## Hook (title)

> Show HN: Coding agents ship sites that say "done" and break – I'm building a verifier that
> tells them exactly what to fix (pre-alpha)

## Body

Agents build and edit websites all day. They stop when the code compiles, not when the site
works: broken links, wrong base URLs, missing alt text, a page an agent can't read. Nothing
checks the built output. Seaworthy is that check. It is pre-alpha — being built in public, task
by task — and this is what it does today from source.

One command reads a built static site (HTML and assets, so any framework, any host) and returns a
versioned report. Every finding carries a stable check ID, an exact location, and a fix hint:

```bash
node packages/verify/dist/src/cli.js verify fixtures/broken
# fixtures/broken (151 pages, 78 checks)
```

A real finding from that run, verbatim:

```text
fixtures/broken/a11y-hidden-focusable/site/index.html
  10:41   error   links.internal  Link to /pricing points to a page that does not exist in the built site.
          fix: Point the link at an existing page, or add the missing page.
```

The report also emits an agent-ready fix prompt per finding, so the loop is: agent builds,
Seaworthy reports, agent fixes, verify again. It reports and never edits your files, and checks
make no network request unless the run opts in (`--network`). Output today: `pretty`, `json`,
`ndjson`, `markdown`, `html`, `sarif`, `llm`, and `prompt` formats; exit codes 0 (clean), 1
(findings at or above the failing severity), 2 (usage error), 4 (a check crashed). The repo also
holds the MCP server and the GitHub Action, both thin adapters over the same engine. What is not
true yet: nothing is published on npm, there is no release, and there are no benchmark numbers.

## Call to action

One link: the repository — https://github.com/arminazimi/seaworthy . From there: read the code,
open an issue if a check gets it wrong, or try it from source (`npm ci && npm run build`, then
the command above). AGENTS.md says how coding agents can claim an issue and send a PR.

## Asset

[`brand/exports/social-preview-dark.png`](../../brand/exports/social-preview-dark.png) (1280 × 640),
per [`brand/launch-1/assets.md`](../../brand/launch-1/assets.md). Hacker News does not render a
post image, so attach it only if the post gets a repository-card preview; otherwise it belongs on
the linked repository, not this post.
