# r/javascript — launch draft (#129)

**This is a draft for review, not a post to send.** Before publishing: re-run the command at your
publish commit and confirm the pasted finding still matches; check the link target and the
subreddit's rules. Owner: `launch1.posts`.

## Format limits

- Reddit title plus body; no character count is set for this channel in the kit, so the constraint
  is in words: the body is what people read after the title, it should stay scannable, and the
  subreddit's self-promotion rules apply.
- The kit's shape for this channel: the same run, written for people who ship front ends — what it
  found and what it cost to fix.

## Hook (title)

> A verifier that checks built static sites for the things bundlers don't catch — one real run,
> one broken link, and what it actually cost to fix (pre-alpha)

## Body

Seaworthy (pre-alpha, built in public) checks the built site — the `dist` folder you deploy — not
your source. HTML and assets, so it doesn't care whether Vite, esbuild, Webpack, or a hand-rolled
script produced it. The pitch to this subreddit is the report itself: every finding has a stable
check ID, an exact location, and a fix hint, so it reads the same to a person and to a coding
agent.

What one real run found. Command:

```bash
node packages/verify/dist/src/cli.js verify fixtures/broken   # 151 pages, 78 checks
```

```text
fixtures/broken/a11y-aria-attributes/site/index.html
  10:9    error   a11y.aria-attributes  aria-lable is not a WAI-ARIA attribute, so assistive technology ignores it. Did you mean aria-label?
          fix: Rename it to aria-label, or remove it.
```

What it cost to fix: one attribute name. The build output says `aria-lable=`; the source template
says the same; rename, rebuild, re-run, the finding is gone — the exit code moves from 1 (findings
at or above the failing severity) back toward 0 (clean). That's the whole loop, and it's why the
report carries machine-readable output: `--format json`, `ndjson`, `markdown`, `html`, `sarif`,
`llm`, `prompt`, or the default `pretty`.

Also in the run, same command, same location format:

```text
fixtures/broken/a11y-hidden-focusable/site/index.html
  10:41   error   links.internal  Link to /pricing points to a page that does not exist in the built site.
          fix: Point the link at an existing page, or add the missing page.
```

Honest limits: nothing is on npm yet, there is no release, no benchmark numbers, no user counts.
Checks don't touch the network unless the run opts in (`--network`). A baseline file
(`--baseline`) lets a site with existing issues fail only on new ones.

## Call to action

Read the code and the roadmap: https://github.com/arminazimi/seaworthy . From a source clone:
`npm ci && npm run build`, then run it on your own built folder. Open an issue when a check is
wrong — a false positive found by a stranger is the most useful bug report a pre-alpha can get.

## Asset

[`brand/exports/social-preview-dark.png`](../../brand/exports/social-preview-dark.png) as the post
preview, per [`brand/launch-1/assets.md`](../../brand/launch-1/assets.md).
