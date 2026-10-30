# r/webdev — launch draft (#129)

**This is a draft for review, not a post to send.** Before publishing: replace the pasted output
with a fresh run at your publish commit (re-run `node packages/verify/dist/src/cli.js verify
fixtures/broken` from a source clone and paste what it prints); pick a screenshot or a short clip
of that real run — a fixed screenshot of a broken site is not claimable until the demo repository
is public (`launch1.demo-repo`, see [`brand/launch-1/facts.md`](../../brand/launch-1/facts.md));
check the subreddit's rules and the link target. Owner: `launch1.posts`.

## Format limits

- A Reddit post is a title plus an optional body; the kit puts the shape as "a screenshot or a
  short clip of the output, not the pitch." No character count is set here, so the real constraint
  is the subreddit's rules and reader tolerance — the image carries the post, the text stays
  under a fold.
- Reddit shows this to a wide audience: say what was found, link the repository, ask for no
  signup ([`brand/launch-1/channels.md`](../../brand/launch-1/channels.md)).

## Hook (title)

> Built a verifier that checks the *built* site, not the source — here's a real run catching a
> dead /pricing link at line 10 (pre-alpha, looking for sites to test against)

## Body

I'm building Seaworthy, pre-alpha, in public. The gap it goes after: coding agents build and edit
websites all day and call done when the code compiles — so broken links and missing alt text ship.
Seaworthy reads the built output (HTML and assets), which is why it works with any framework and
on any host.

The site in the screenshot is a deliberately broken test fixture kept in the repo — plain built
HTML, no framework, its expected findings written down in `expected.json` so the checks are honest
against it. That's the same way a Jekyll, Astro, or Hugo output gets read: Seaworthy never needs
the generator, only the folder.

The finding in the image, verbatim from `verify fixtures/broken` (151 pages, 78 checks):

```text
fixtures/broken/a11y-hidden-focusable/site/index.html
  10:41   error   links.internal  Link to /pricing points to a page that does not exist in the built site.
          fix: Point the link at an existing page, or add the missing page.
```

Every finding has a stable check ID, an exact file:line:column location, and a fix hint. It
reports and never edits. Checks make no network request unless the run opts in (`--network`).
What it does not do: score your site with a grade, read your source, or pretend it's released —
nothing is on npm yet.

## Call to action

The repository: https://github.com/arminazimi/seaworthy — read the code, run it from source
(`npm ci && npm run build`, then `node packages/verify/dist/src/cli.js verify ./dist` on your
built folder), and open an issue for every false positive; those are bug reports, and the pre-alpha
promise is a fast answer.

## Asset

[`brand/exports/social-preview-dark.png`](../../brand/exports/social-preview-dark.png) as the
link/post preview; the actual post image is the screenshot or clip of the real run (crop the
`seaworthy 0.0.0` version line — there is no released version).
