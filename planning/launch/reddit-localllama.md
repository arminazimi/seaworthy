# r/LocalLLaMA — launch draft (#129)

**This is a draft for review, not a post to send.** The kit's shape for this channel is "the same
loop, with the model and the prompt it ran with" — so before publishing you must actually run the
loop with a specific local model and paste what happened: model name and quantization, the harness
(your agent scaffolding), the exact finding and the exact `prompt`-field text the report handed the
model, and what it changed. Everything in the brackets below is a placeholder for your run. Do not
keep any claim about a model's behavior you did not observe. Owner: `launch1.posts`.

## Format limits

- Reddit title plus body; no character count is set for this channel in the kit, so the constraint
  is in words: this community reads methodology, so the model, the harness, and the raw transcripts
  matter more than length, and the subreddit's rules apply.

## Hook (title)

> A static-site verifier built for agent loops: findings as JSON with file:line + a fix prompt you
> can hand to [MODEL] — here's [MODEL AT QUANT] actually fixing one (pre-alpha)

## Body

Seaworthy verifies built static sites (HTML and assets — any generator, any host) and its report
is made for a loop an agent can run: stable check IDs, exact locations, and a fix hint per
finding, including a `prompt` field written to be pasted to a coding agent. Status: pre-alpha,
built in public from source — nothing on npm, no release, no version to quote.

What ran ([describe your setup: model, quantization, context length, the agent harness, the site
it was given]):

1. [MODEL] built/edited the site; we ran
   `node packages/verify/dist/src/cli.js verify ./dist --format json` from a source clone
   (`npm ci && npm run build`).
2. The report's exit code was 1 (findings at or above the failing severity). A real finding from
   the repo's own test run, verbatim, to show the shape:

```text
a11y-hidden-focusable/site/index.html
  10:41  error  links.internal  Link to /pricing points to a page that does not exist in the built site.
```

3. The `prompt` field for that finding, verbatim from the report:

> Fix this Seaworthy finding. Check links.internal (error) at … Link to /pricing points to a page
> that does not exist in the built site. Fix: Point the link at an existing page, or add the
> missing page.. The location is the built output; apply the same fix in the source that generates
> it, rebuild, then re-run seaworthy verify to confirm the finding is gone.

4. [PASTE: the model's actual diff/change, and the second verify run's result — pass or not.]

Design notes for this crowd: the engine never runs the site's code — it parses HTML and assets as
untrusted input; no network unless `--network` is passed; `--rendered` gates the checks that need
a browser; the repo also carries an MCP server (`packages/mcp`, tools `list_checks`, `verify_site`,
`verify_changed`) you can wire into a local agent from source. It reports and never edits — the
model applies fixes, verify confirms them.

## Call to action

The repository: https://github.com/arminazimi/seaworthy . Run the loop with your model and open an
issue with the transcript if a finding was unfixable-as-written — this is exactly the feedback
pre-alpha is collecting.

## Asset

[`brand/exports/social-preview-dark.png`](../../brand/exports/social-preview-dark.png) as the post
preview; the transcript screenshots come from your run.
