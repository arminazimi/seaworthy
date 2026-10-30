# WCAG 2.2 post — launch draft (#302)

**This is a draft for review, not a post to send.** Before publishing: re-run the two commands in
"The run behind this post" at your publish commit and replace any number or output line that
differs (a dev build prints `seaworthy 0.0.0`, and there is no released version to quote); confirm
every `docs/` link target still exists; re-read [`brand/launch-1/facts.md`](../../brand/launch-1/facts.md)
— nothing here is a benchmark or accuracy claim, all counts are fixture runs. Owner:
`launch1.accessibility-post`.

## Format limits

- A full blog post (dev.to or the project blog): front-matter title plus a Markdown body of any
  length. The kit sets no character count for this channel; the constraint is honesty — every
  number in the post must be reproducible from a command printed in the post.
- The post must not restate [`docs/wcag-what-automation-proves.md`](../../docs/wcag-what-automation-proves.md)
  or the per-check pages under [`docs/checks/`](../../docs/checks/README.md); it links to them.

## Hook (title)

> Coding agents ship sites that pass the build and fail the keyboard — what an automated WCAG 2.2
> check can honestly prove, and what it can't

## Body

Agents build and edit websites all day, and they stop when the code compiles, not when the site
works. Seaworthy closes the first part of that gap: one command reads the *built* output and
returns a versioned report where every finding has a stable check ID, a location, and a fix hint
an agent can apply. Accessibility is the lane where a second gap opens, and this post is about
that one: the distance between "the report is green" and "the site is accessible" is real, and we
would rather say so than sell it.

### What a plain run proves

WCAG 2.2 is a published W3C recommendation; conformance is a statement a person makes about a
site. What automated checks can produce is evidence for parts of that statement. In the current
checkout, the report lists 88 checks and the standards each cites; 34 of them cite WCAG. 28 of
those 34 run in the default, offline, no-browser pass, and each proves a narrow, machine-visible
fact:

- `images.alt` proves an `<img>` has an `alt` attribute — not that the text describes the picture
  (WCAG 1.1.1).
- `a11y.skip-link` and `a11y.landmarks` look for the skip link and landmark structure behind
  WCAG 2.4.1 Bypass Blocks.
- `meta.viewport` proves the viewport meta tag neither blocks zoom nor pins its scale
  (WCAG 1.4.4 Resize Text).
- `a11y.autocomplete` validates autofill tokens, the machine-decidable part of WCAG 1.3.5
  Identify Input Purpose.

The full mapping — which check cites which success criterion — is one table in
[`docs/wcag-what-automation-proves.md`](https://github.com/arminazimi/seaworthy/blob/main/docs/wcag-what-automation-proves.md),
and every check ID has a page under `docs/checks/` stating exactly what it decides and what it
refuses to guess. That is what a finding claims; it is not a conformance verdict.

### The run behind this post

From a source checkout (`npm ci && npm run build`), a plain run over the repository's deliberately
broken fixture:

```bash
node packages/verify/dist/src/cli.js verify fixtures/broken --format json --out seaworthy.json
# seaworthy: 1000 findings (205 errors, 696 warnings, 449 notes); json report written to seaworthy.json
```

That run scanned 159 pages and skipped 9 checks, and the report says so by name: six WCAG-citing
checks (`a11y.axe`, `layout.focus-visible`, `layout.horizontal-overflow`, `layout.reflow`,
`layout.target-size`, `layout.text-clipped`) plus `readability.webmcp` carry the reason
`rendered-checks-disabled` — they need a browser and the run did not ask for one — and
`links.external` and `readability.markdown-negotiation` carry `network-checks-disabled`. Read the
`skipped` array before calling anything a pass: a green default run is a green *static* run.

No accessibility check phones home: the two network-gated checks above are the only ones that
make requests, and neither cites WCAG. Rendered runs stay offline too — pages load from `file://`
and requests to remote resources are aborted, and Seaworthy never downloads a browser; it launches
the Chrome, Chromium, or Edge already on your machine ([ADR 0005](https://github.com/arminazimi/seaworthy/blob/main/docs/adr/0005-headless-browser.md)).

### What `--rendered` adds

With `--rendered`, the six opt-in checks measure the rendered page instead of the markup. They
also need `playwright-core` (`npm install --no-save playwright-core` in the site's folder; the
repo's own `npm ci` installs it) and a browser; with either missing, the report records them as
skipped with a re-enable hint instead of failing the run. On this machine (Chrome installed), the
same command on one fixture sub-site reports:

```bash
node packages/verify/dist/src/cli.js verify fixtures/broken/a11y-skip-link --rendered
# seaworthy: 32 findings (10 errors, 12 warnings, 10 notes)
```

and the `skipped` array shrinks to the two network checks and `readability.webmcp` — the last with
its own honest reason, `webmcp-unsupported`, because an ordinary browser exposes no WebMCP model
context (it is a draft spec in a Chromium origin trial). What each of the six decides:

- `layout.focus-visible` tabs through the page in a real browser and compares the computed
  appearance before and after each focus stop — a WCAG 2.4.7 Focus Visible failure is measured,
  not guessed from CSS (check page:
  [`docs/checks/layout.focus-visible.md`](https://github.com/arminazimi/seaworthy/blob/main/docs/checks/layout.focus-visible.md)).
- `layout.reflow` measures the document at exactly 320 CSS px, the width WCAG 1.4.10 Reflow
  fixes, and names the outermost box that refuses to shrink; `layout.horizontal-overflow` is its
  sibling for sideways panning at a real phone width (375 px).
- `layout.target-size` measures every rendered interactive element against the 24×24 CSS px
  minimum of WCAG 2.5.8 Target Size (Minimum), applying the criterion's inline-link exception
  explicitly.
- `layout.text-clipped` compares `scrollWidth`/`scrollHeight` with `clientWidth`/`clientHeight`
  and reports text its box cuts off with no way to reach it (1.4.10, and 1.4.4 where a px-fixed
  box stops growing with zoomed text).
- `a11y.axe` runs axe-core over the post-script DOM for what a parser cannot compute — contrast
  (WCAG 1.4.3) among them — with the rules the source-level checks already own switched off, so
  one problem keeps one finding.

Every rendered check measures each page at phone (375 px), tablet (768 px), and desktop
(1280 px); one element at several widths is one finding that names its widths.

### What no automated pass can prove

Say this plainly, because it is the part people get wrong:

- Whether the `alt` text is **accurate**, whether reading order makes **sense**, whether a
  focus order that violates nothing is still confusing — these are judgements about meaning, and
  the checks deliberately stop at the machine-decidable facts next to them.
- A rendered check measures a viewport, not a user: three widths, one browser, one machine. The
  person with a screen reader, a switch device, or a magnifier is not in the sample.
- Passing every check is not a conformance claim. Only you can make that claim, with the report —
  flags included, because they change what ran — as dated evidence under it.
- Some success criteria have no check citing them here at all. WCAG 3.3.7 Redundant Entry is one:
  nothing in this repository's check metadata cites it today. Grep it yourself:
  `grep -rho 'meta("[^"]*"' packages/verify/src/checks | sort -u`.
- The manual work survives a green report: keyboard-only traversal of every interactive path, a
  200-percent zoom pass, at least one screen-reader and one voice-control run over real flows,
  and caption and transcript quality. The list, with the reasoning, is in
  [`docs/wcag-what-automation-proves.md`](https://github.com/arminazimi/seaworthy/blob/main/docs/wcag-what-automation-proves.md)
  — including what to record in an accessibility statement, and why a report is not an
  "audit-ready" artifact in any legal sense.

For an agent-driven loop the honest shape is: agent builds, `seaworthy verify` closes the
machine-decidable part with fix hints the agent can apply, a human does the keyboard and
screen-reader pass, and both dates go in the statement. Seaworthy reports and suggests; it never
edits your files.

### Try it today (pre-alpha, honestly)

Nothing is published on npm and there is no release tag. The runnable form today is a source
checkout — `npm ci && npm run build`, then:

```bash
node packages/verify/dist/src/cli.js verify   # tries dist, build, out, public, _site, site in order
```

To pin it into a site repository, use the git pin —
`npm install --no-save github:arminazimi/seaworthy#<full commit SHA>`, placed *after* the site's
own `npm ci` (which wipes it) — and record the SHA. `seaworthy 0.0.0` is what a dev build prints;
it is not a version to quote.

If a check gets it wrong, that is a bug report; if a rule is missing, that is a check proposal —
both are issue templates in the repository. And before you quote a green report anywhere, read
what it actually says ran.

## Call to action

One link: the repository — https://github.com/arminazimi/seaworthy — starting from
[`docs/wcag-what-automation-proves.md`](https://github.com/arminazimi/seaworthy/blob/main/docs/wcag-what-automation-proves.md)
and any check's page under `docs/checks/`.

## Claim sources

Every assertion above traces to a page in this repository, not to this post's own reasoning:

| Claim in the post | Source page |
| --- | --- |
| Static checks prove narrow machine-visible facts; green default run = green static run; rendered checks measure viewports not users; conformance is a human claim; the manual-work list | [`docs/wcag-what-automation-proves.md`](../../docs/wcag-what-automation-proves.md) |
| 2.4.7 focus-visible method (tab-through, computed repaint, three widths, `outline: none` with replacement never reported) | [`docs/checks/layout.focus-visible.md`](../../docs/checks/layout.focus-visible.md) |
| 1.4.10 at exactly 320 CSS px, table/scroll-container exceptions, outermost-box reporting | [`docs/checks/layout.reflow.md`](../../docs/checks/layout.reflow.md) |
| 375-px document panning vs. the 320-px spec question; own-scroll containers allowed | [`docs/checks/layout.horizontal-overflow.md`](../../docs/checks/layout.horizontal-overflow.md) |
| Box smaller than its text with no way to reach it; deliberate ellipses not reported; 1.4.10 + 1.4.4 mapping; "measurement, not conformance verdict" | [`docs/checks/layout.text-clipped.md`](../../docs/checks/layout.text-clipped.md) |
| 24×24 CSS px minimum, 2.5.8, inline exception, axe `target-size` rule switched off | [`docs/checks/layout.target-size.md`](../../docs/checks/layout.target-size.md) |
| axe-core coverage (contrast 1.4.3 etc.), rules de-duplicated against source checks, `incomplete` not reported | [`docs/checks/a11y.axe.md`](../../docs/checks/a11y.axe.md) |
| WebMCP is a draft, note-only, skips with `webmcp-unsupported` on ordinary browsers | [`docs/checks/readability.webmcp.md`](../../docs/checks/readability.webmcp.md) |
| 2.4.1 mapping for skip link and landmarks; 1.3.5 for autocomplete; browser-found-locally gating (ADR 0005) | [`docs/checks/a11y.skip-link.md`](../../docs/checks/a11y.skip-link.md), [`docs/checks/a11y.landmarks.md`](../../docs/checks/a11y.landmarks.md), [`docs/checks/a11y.autocomplete.md`](../../docs/checks/a11y.autocomplete.md), [`docs/adr/0005-headless-browser.md`](../../docs/adr/0005-headless-browser.md) |
| Counts (88 checks listed, 34 citing WCAG, 28 of them default; 159 pages; 1000 findings; skip reasons) | Measured, not asserted: the two commands under "The run behind this post" and "What `--rendered` adds", run in this checkout |
