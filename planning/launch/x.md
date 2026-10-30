# X — launch draft (#129)

**This is a draft for review, not a post to send.** Before publishing: re-run the command at your
publish commit and confirm the pasted finding matches; count the opener's characters in the real
composer before posting; check the link preview renders and the pinned commit in any install line
still exists. Owner: `launch1.posts`.

## Format limits

- The kit states the one hard number for this channel: the opener is **one post under 280
  characters**, then **a thread with the run**. Thread replies keep to X's per-post limit; state
  each as its own numbered post. The repository link costs characters in the composer, so the
  opener's count must be checked after the link goes in.

## Hook (opener, under 280 characters — verify the count in the composer before posting)

> Agents ship sites that "compile" and break. We're building Seaworthy: one command checks the
> built folder and returns findings with a stable ID, file:line:col, and a fix hint. Pre-alpha, in
> public. Repo ↓

(With the link and preview card, keep the total under the limit; if the composer says otherwise,
cut the second sentence before touching the finding.)

## Body (the thread, one post per number)

1/ The run, from source today (`npm ci && npm run build` in a clone of the repo):
`node packages/verify/dist/src/cli.js verify fixtures/broken` → 151 pages, 78 checks, exit code 1.

2/ One real finding, verbatim:
a11y-hidden-focusable/site/index.html — 10:41 error `links.internal` — "Link to /pricing points to
a page that does not exist in the built site." Fix hint: point it at an existing page or add the
page.

3/ The typo catch, same run: 10:9 error `a11y.aria-attributes` — "aria-lable is not a WAI-ARIA
attribute, so assistive technology ignores it. Did you mean aria-label?" One rename to fix.

4/ Built for the agent loop: `--format json` gives every finding a `prompt` field — text to hand a
coding agent: fix the source, rebuild, re-run, confirm it's gone. Exit codes: 0 clean, 1 findings,
2 usage, 4 a check crashed.

5/ Reports, never edits. No network unless you opt in (`--network`). Any framework — it reads the
built folder, not your generator.

6/ Honest status: pre-alpha. Nothing on npm, no release, no benchmark numbers, no user counts. You
can read the code, run it from source, and open an issue — pinned-install is
`npm install --no-save github:arminazimi/seaworthy#<commit>`, run after your own `npm ci`.

7/ Repo: https://github.com/arminazimi/seaworthy — Ship sites agents can trust.

## Call to action

Follow for the build log; read the repository; open an issue for every finding that reads wrong.
The pinned git install above is the only way to run it today, and it stays true until the release
makes `npx seaworthy verify ./dist` the real line.

## Asset

[`brand/exports/social-preview-dark.png`](../../brand/exports/social-preview-dark.png) attached to
the opener (1280 × 640). Crop or omit screenshots that show the dev-build `seaworthy 0.0.0` line —
there is no released version to quote.
