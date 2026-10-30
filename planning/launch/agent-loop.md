# Before and after: one full turn of the agent loop — launch wave 2 draft (#156)

**This is a draft for review, not a post to send.** Before publishing: re-run every command at your
publish commit and replace any output that differs; keep the note that the site under test is a
scratch copy, never a repository file. The loop mechanics — every flag, format, and stage — live on
[docs/agent-loop.md](../../docs/agent-loop.md); this post is the one worked example, not a second
manual. Owner: `launch2.posts`. Claims table: [`brand/launch-1/facts.md`](../../brand/launch-1/facts.md).

## Format limits

- A full article (dev.to or blog), body Markdown. Shorter than the loop page on purpose: it shows
  one before → fix → after cycle start to finish, with every output pasted from a real run.
- No restating the loop documentation; where the story needs a flag's behavior, link to the page.

## Hook (title)

> An agent broke a site in three places; here is the exact transcript of finding and fixing all
> three (Seaworthy pre-alpha, real run inside)

## Body

> **Status up front: pre-alpha.** Nothing on npm, no release, no tag. This runs from a source
> clone: `npm ci && npm run build`, then `node packages/verify/dist/src/cli.js …`.

The claim of the agent loop is simple: a verifier built for agents should let one close the
change → build → verify circle without a human in the middle. The
[loop page](../../docs/agent-loop.md) documents how. This is one full turn, on a real folder, with
the outputs pasted as they printed.

### Setup

The repository ships ground-truth fixtures. `fixtures/clean/minimal/site` is the clean one: four
pages that every built-in check must accept. Copied to a scratch folder (so no cache or history
file is ever written inside the repo), the baseline is:

```bash
node packages/verify/dist/src/cli.js verify site --format llm
# seaworthy llm site: 0 findings in 0 files, 4 pages, 88 checks → exit 0
```

Then three mistakes an agent actually makes, typed into `site/`:

1. the nav link `/about.html` becomes `/pricing` — the agent meant to build that page later;
2. an `<img>` loses its `alt` attribute in a refactor;
3. a rewrite drops `about.html`'s meta description.

### Before: the run that catches all three

```bash
node packages/verify/dist/src/cli.js verify site --format llm   # exit 1
```

```text
seaworthy llm site: 3 findings in 2 files (2 errors, 1 warning), 4 pages, 88 checks
about.html
  Add a one-sentence description. Search engines and link previews show it. | meta.description warning | about.html:3:1 | The page has no meta description.
index.html
  Point the link at an existing page, or add the missing page. | links.internal error | index.html:17:40 | Link to /pricing points to a page that does not exist in the built site.
  Add alt text that describes what the image shows, or alt="" if it is purely decorative. Without the attribute, screen readers read out the file name. | images.alt error | index.html:21:5 | <img src="/logo.png"> has no alt attribute.
```

Three lines, each with the fix first, then check ID, severity, and a location pointing at the
exact attribute. That is the whole reading an agent needs; the skipped gated checks and the
readability line follow in the same output.

### What an agent gets instead of prose

The same findings in `--format json` carry machine-usable edits and a self-contained prompt. The
`images.alt` finding, exactly as the report wrote it:

```json
{
  "checkId": "images.alt",
  "severity": "error",
  "message": "<img src=\"/logo.png\"> has no alt attribute.",
  "location": { "file": "index.html", "line": 21, "column": 5 },
  "fix": {
    "kind": "edit",
    "summary": "Add alt text that describes what the image shows, or alt=\"\" if it is purely decorative. Without the attribute, screen readers read out the file name.",
    "edits": [
      { "file": "index.html", "line": 21, "action": "replace", "find": "src=\"/logo.png\"", "replace": "src=\"/logo.png\" alt=\"<describe the image>\"", "needsInput": true }
    ],
    "appliesTo": "built-output"
  },
  "prompt": "Fix this Seaworthy finding. Check images.alt (error) at site/index.html:21:5. <img src=\"/logo.png\"> has no alt attribute. Fix: Add alt text that describes what the image shows, or alt=\"\" if it is purely decorative. Without the attribute, screen readers read out the file name.. Edit: on line 21, replace 'src=\"/logo.png\"' with content you choose. The location is the built output; apply the same fix in the source that generates it, rebuild, then re-run seaworthy verify to confirm the finding is gone."
}
```

`needsInput: true` is the honesty of the design: the verifier knows where the edit goes but will
not invent your alt text. And `seaworthy fix site --dry-run` — the one-diff preview — printed, for
this run:

```text
seaworthy: 0 edits in 0 files; 3 findings need manual guidance
  meta.description (warning) about.html:3: The page has no meta description. needs input: the edit inserts content only a person can supply. Fix: Add a one-sentence description. Search engines and link previews show it.
  links.internal (error) index.html:17: Link to /pricing points to a page that does not exist in the built site. manual: the check has no edit for this case. Fix: Point the link at an existing page, or add the missing page.
  images.alt (error) index.html:21: <img src="/logo.png"> has no alt attribute. needs input: the edit inserts content only a person can supply. Fix: Add alt text that describes what the image shows, or alt="" if it is purely decorative. Without the attribute, screen readers read out the file name.
```

No diff to apply, every finding still telling the actor exactly what to supply. Seaworthy reports
and suggests; applying the fix is the agent's move.

### After: the same command, twice

The three fixes land in the source that generates these pages (here, by hand in the copy; in
practice, in the template), rebuild, re-verify:

```bash
node packages/verify/dist/src/cli.js verify site --format llm
```

```text
seaworthy llm site: 0 findings in 0 files, 4 pages, 88 checks
readability: 100/100 (3 of 3 applicable checks clean)
```

Exit code 0. The scratch copy is once again byte-identical to the shipped clean fixture — the
before/after pair closes inside the ground truth.

### Gating it in CI

Default `--fail-on` is `error`, so the run above fails on the two link/alt errors. The severity
ladder is worth seeing once: the canonical fixture reports 69 findings (`52 warnings, 17 notes`)
and still **exits 0** at the default gate — none of them are errors — while
`--fail-on warning` on the same folder exits 1. Both measured, same machine as the timings below.
For the gate flags, `--changed`, `--watch`, baselines, and what each costs: that is the
[loop page](../../docs/agent-loop.md), not this post.

## Call to action

Repo: https://github.com/arminazimi/seaworthy . Reproduce the whole transcript in four commands:
clone, `npm ci && npm run build`, copy `fixtures/clean/minimal/site` anywhere outside the repo,
run the verify command above, make the three edits, run it again. Or wire it into a project:
`npm install --no-save github:arminazimi/seaworthy#<full-commit-SHA>` after your own `npm ci`
(pin the full SHA; the next `npm ci` removes it — there is no npm package yet).

## What you will not find here

No agent doing the fixing on camera — the fixes here were typed by hand; the loop page documents
what the agent reads (`prompt`, `fix.edits`, `--format llm`). No speed promises beyond the measured
runs below. No claim that three findings is typical of real sites: the canonical fixture's 69 are
the counterexample, linked above.

## Measurements

Measured **October 30, 2026** on macOS 26.6.1, Apple M5, Node v22.23.1, from a built checkout
(`npm run build`) invoking `node packages/verify/dist/src/cli.js …`, all runs from a scratch
folder outside the repository so cache and history never touched it. Wall time (`/usr/bin/time`):
before-run 0.07 s, after-run 0.06 s; the after-run's `--timings` block: engine total 17.9 ms
(site 4.2 ms · checks 11.5 ms · report 0.3 ms). Orders of magnitude on an idle machine, not
constants.
