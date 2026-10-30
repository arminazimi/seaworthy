# dev.to — launch draft (#129)

**This is a draft for review, not a post to send.** Before publishing: run every command in this
draft at your publish commit and replace any output that differs; decide whether the checked site
is still the repo fixture or the public demo repository (`launch1.demo-repo`) and update the
"what we checked" section to match; re-check the link targets and the tags. Owner: `launch1.posts`.

## Format limits

- A full article: front matter with title, tags, cover image; the body is Markdown of any length.
  The kit names no character counts for dev.to, so the constraint is in words: it is the one
  channel with room for the whole story — the site that was checked, the findings with their
  locations, and the fix.
- dev.to shows the cover image in the feed; per [`brand/launch-1/assets.md`](../../brand/launch-1/assets.md)
  this channel uses the social preview as cover and the banner inside the post.

## Hook (title)

> Seaworthy: verifying a built static site the way an agent would want to read it (pre-alpha,
> real run inside)

## Body

> **Status up front: pre-alpha.** This repository is being built in public, task by task. Nothing
> here is on npm, there is no release version, no benchmarks, and no user counts. What works today
> runs from source, and this post shows a real run you can reproduce.

### Why

Coding agents build and edit websites all day. They stop when the code compiles, not when the site
works — so broken links, a wrong base URL, missing alt text, and pages that agents and AI search
can't read ship every day because nothing checks the built output. The loop agents already run
(change, build, test) ends before the deploy. Seaworthy checks what comes out of the
build.

### What it is

Seaworthy verifies websites for agents. One command checks any built static site, from any
framework and on any host, and returns a versioned, machine-readable report. Every finding has a
stable check ID, an exact location, and a fix hint. It is built on existing standards — WCAG,
HTML, schema.org, `llms.txt`, Markdown alternates, SARIF — rather than inventing a competing
format.

### The site we checked

The repo's own test fixtures: deliberately broken built sites with ground truth — for each, the
exact findings Seaworthy must report, kept honest by `expected.json` and the test suite. Today's
post uses `fixtures/broken`: plain built HTML, 151 pages, no framework. (If you publish after the
demo repository exists, swap in a run against it and say which generator built it.)

### The run

From a source clone (`npm ci && npm run build`):

```bash
node packages/verify/dist/src/cli.js verify fixtures/broken
# header: fixtures/broken (151 pages, 78 checks)
```

Exit code 1 (findings at or above the failing severity; 0 is clean, 2 is a usage error, 4 says a
check crashed). Two real findings, verbatim:

```text
fixtures/broken/a11y-hidden-focusable/site/index.html
  10:41   error   links.internal  Link to /pricing points to a page that does not exist in the built site.
          fix: Point the link at an existing page, or add the missing page.

fixtures/broken/a11y-aria-attributes/site/index.html
  10:9    error   a11y.aria-attributes  aria-lable is not a WAI-ARIA attribute, so assistive technology ignores it. Did you mean aria-label?
          fix: Rename it to aria-label, or remove it.
```

### The fix

The second one costs one rename in the template that generated the page: `aria-lable=` becomes
`aria-label=`. Rebuild, re-run, the finding is gone — that's the loop. For an agent, the JSON
report goes one step further: every finding carries a `prompt` field written to hand to a coding
agent, including the location, the fix, and the instruction to apply it in the source, rebuild,
and re-verify.

### What else is in the report

`--format` writes `pretty` (the default), `json`, `ndjson`, `markdown`, `html`, `sarif`, `llm`,
and `prompt`. A baseline file (`--baseline`, `--update-baseline`) lets an existing site adopt it
and fail only on new findings. Checks make no network request unless the run opts in
(`--network`); the checks that need a real browser are gated behind `--rendered`. The repo also
carries a GitHub Action (`action.yml`, inputs `site`, `threshold`, `sarif`) and an MCP server
(`packages/mcp`, tools `list_checks`, `verify_site`, `verify_changed`) — both thin adapters over
the same engine, neither published yet. The Agent Skills on the roadmap are planned, not shipped.

### What it does not do

No score, no grade — findings with locations. It never edits your files; it reports and suggests.
It never reads your source; it reads the build output. And it is not released: no npm packages, no
version numbers, no "works with every site" claims.

## Call to action

Read the repository and the roadmap: https://github.com/arminazimi/seaworthy . Run it on your own
`dist` folder from source, and open an issue for every finding you disagree with — in pre-alpha,
a false positive is the most valuable bug report there is. To wire the CLI into a project today:
`npm install --no-save github:arminazimi/seaworthy#<commit>` after your own `npm ci` (pin the
commit; a later `npm ci` removes it).

## Assets

Cover: [`brand/exports/social-preview-dark.png`](../../brand/exports/social-preview-dark.png)
(1280 × 640). Inside the post: [`brand/exports/banner-dark.png`](../../brand/exports/banner-dark.png)
(1500 × 500). Screenshots of the run must come from your real run; crop the dev-build
`seaworthy 0.0.0` line out of any paste.
