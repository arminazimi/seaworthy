# What automated checks prove about WCAG, and what they do not

Seaworthy verifies built sites for machine-observable problems. Accessibility is one of its lanes,
and it is the lane where the gap between "the report is green" and "the site is accessible" is
widest. This page states that gap plainly: what an automated pass proves, what it cannot prove, and
what the difference means for a site owner answering to WCAG or to the European Accessibility Act.

Every claim here is read out of this repository's own code, not from memory. To reproduce the
check list: `grep -rho 'meta("[^"]*"' packages/verify/src/checks | sort -u` (80 checks on `main` at
the time of writing), then the `standards` each check declares.

## What "an automated pass" means here

A finding is a machine-observable fact about a file. From `packages/verify/src/types.ts` and
`packages/verify/src/report.ts`, every finding carries:

- a stable `checkId` (`images.alt`, `a11y.tabindex`, …) and a `severity` (`error`, `warning`, `note`);
- a `location`: a site-relative file, and a line and column where the parser found one, or a CSS
  selector and snippet where a rendered check found the element instead;
- a `fix`: a one-line summary an agent or human can act on, sometimes with text-anchored `edits` —
  and an `appliesTo: "built-output"` warning, because findings point at built files while fixes
  belong in source;
- a `fingerprint`: a hash of check ID, file, and a stable key, so the same problem is the same
  problem from run to run.

The report itself is deterministic — sorted, no timestamps, no absolute paths — and it lists every
check that ran, with its `needs` and `standards`, plus every check that was skipped and why. Two
things the trust rules in [AGENTS.md](../AGENTS.md) guarantee: site contents are parsed, never
evaluated; and Seaworthy reports and suggests, never edits your files.

So "an automated pass" means: *for the enabled checks, nothing in the built output violated a rule
a machine could decide by reading or rendering the files.* It is a statement about facts on disk,
not about anyone's experience.

## What the accessibility-adjacent checks actually prove

29 of the 80 checks cite WCAG in their `standards` metadata. All run by default except `a11y.axe`,
which needs a browser and `--rendered`. `--network` gates only `links.external` and
`readability.markdown-negotiation`, and neither cites WCAG — no accessibility check phones home.

| Check ID | WCAG criterion cited in its `standards` | Static or rendered | Default or opt-in |
| --- | --- | --- | --- |
| `a11y.aria-attributes` | WCAG 4.1.2 | static | default |
| `a11y.aria-references` | WCAG 1.3.1, WCAG 4.1.2 | static | default |
| `a11y.aria-roles` | WCAG 4.1.2 | static | default |
| `a11y.autocomplete` | WCAG 1.3.5 | static | default |
| `a11y.axe` | WCAG 1.4.3, WCAG 2.5.8, WCAG 4.1.2 | rendered | opt-in (`--rendered`) |
| `a11y.duplicate-id` | WCAG 1.3.1, WCAG 4.1.2 | static | default |
| `a11y.empty-headings` | WCAG 1.3.1, WCAG 2.4.6 | static | default |
| `a11y.hidden-focusable` | WCAG 4.1.2, WCAG 2.4.3 | static | default |
| `a11y.iframe-title` | WCAG 4.1.2 | static | default |
| `a11y.landmarks` | WCAG 1.3.1, WCAG 2.4.1 | static | default |
| `a11y.lang-parts` | WCAG 3.1.2 | static | default |
| `a11y.media-captions` | WCAG 1.2.2, WCAG 1.4.2 | static | default |
| `a11y.radio-groups` | WCAG 1.3.1, WCAG 3.3.2 | static | default |
| `a11y.skip-link` | WCAG 2.4.1 | static | default |
| `a11y.tabindex` | WCAG 2.4.3 | static | default |
| `a11y.table-headers` | WCAG 1.3.1 | static | default |
| `headings.h1` | WCAG 1.3.1 | static | default |
| `headings.order` | WCAG 1.3.1 | static | default |
| `html.meta-refresh` | WCAG 2.2.1 | static | default |
| `html.redirect-chain` | WCAG 2.2.1 | static | default |
| `images.alt` | WCAG 1.1.1 | static | default |
| `md.images` | WCAG 1.1.1 | static | default |
| `meta.lang` | WCAG 3.1.1 | static | default |
| `meta.title` | WCAG 2.4.2 | static | default |
| `meta.viewport` | WCAG 1.4.4 | static | default |
| `names.button` | WCAG 4.1.2 | static | default |
| `names.label` | WCAG 1.3.1, WCAG 3.3.2, WCAG 4.1.2 | static | default |
| `names.link` | WCAG 2.4.4, WCAG 4.1.2 | static | default |
| `rtl.bidi` | WCAG 3.1.2 | static | default |

Each of these proves a narrow, real fact. `images.alt` proves an `<img>` has an `alt` attribute; it
says nothing about whether the attribute's text describes the picture. `meta.viewport` proves the
viewport meta tag neither blocks zoom nor pins its scale. `a11y.tabindex` proves no element carries
a positive `tabindex` that would reorder the tab sequence — not that the remaining order makes
sense. `a11y.media-captions` proves a `<video>` references a caption track and no media autoplays
sound; it cannot watch the video or read the transcript.

`a11y.axe` ([`packages/verify/src/checks/a11y-axe.ts`](../packages/verify/src/checks/a11y-axe.ts))
adds what a parser cannot decide: computed contrast, minimum target size, and rules over the DOM
after scripts have run. Every page is loaded from `file://` in a real browser at three viewport
widths (phone, tablet, desktop), and the same rule on the same element at several widths merges
into one finding that names the widths. Everything stays local: `--rendered` never touches the
network, and requests to remote resources are aborted.

## What no automated pass can prove

This is the honest part, and the reason this page exists.

**axe-core is one engine, and by default it does not run at all.** It is a third-party rule set with
its own blind spots; Seaworthy's static checks are a different set of eyes, not a substitute for
it. Without `--rendered` — or with it but no playwright-core and no installed Chrome, Chromium, or
Edge — the engine records the check as *skipped*, with the hint to re-enable it, in the report. A
green default run is therefore a green *static* run. Check the report's `skipped` array before you
call anything a pass.

**A rendered check measures a viewport, not a user.** Three widths, one browser, one machine,
scripts loaded, fonts present. A person with a screen reader, a switch device, a magnifier, or a
slower connection is not in the sample and cannot be.

**Passing every check is not a conformance claim.** WCAG 2.2 defines Level A, AA, and AAA as
conformance targets ([the W3C recommendation](https://www.w3.org/TR/WCAG22/)); conformance is a
statement a person makes about a site, supported by evidence. A Seaworthy report is evidence. It is
not the statement, and no run makes one on your behalf.

**Some WCAG success criteria can't be decided by any tool, automated or not.** No tool can judge
whether alt text is *accurate*, whether reading order makes *sense* when the visual layout and DOM
order disagree, whether a focus order that contains no violations is nevertheless confusing, or
whether language is comprehensibly simple for the audience a criterion speaks about. These are
judgements about meaning, and the checks above deliberately stop at the machine-decidable facts
next to them.

**The manual work remains yours.** Concretely, what an accessible site still needs after a green
report:

- keyboard-only traversal of every interactive path — tab, activate, dismiss, no mouse;
- zoom to 200 percent (`1.4.4`, the criterion `meta.viewport` cites) and a reflow check at a width
  equivalent to 320 CSS pixels ([SC 1.4.10 Reflow, Level AA](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html))
  — with your real content, not an empty page;
- at least one screen reader and one voice-control pass over the flows users actually take;
- caption and transcript *quality*, which no attribute check can grade;
- a human judgement on contrast where the tool is blind by construction: text baked into an image
  has no computed color for axe to compare.

## The European Accessibility Act, kept defensible

The European Accessibility Act is Directive (EU) 2019/882 of the European Parliament and of the
Council of 17 April 2019 on harmonising accessibility requirements for
[products and services](https://eur-lex.europa.eu/eli/dir/2019/882/oj) placed on the EU internal
market. It is law about products and services — computers, banking, e-commerce, transport, and the
like — not a law about HTML.

The technical baseline people reach for is the harmonised standard EN 301 549, "Accessibility
requirements for ICT products and services", maintained at
[ETSI](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_60/en_301549v030201p.pdf).
Its mapping to WCAG has recently moved, and the current state — per the European Commission's
official page [published 2026-09-07](https://accessible-eu-centre.ec.europa.eu/content-corner/news/european-accessibility-standard-en-301-549-has-been-updated-2026-09-07_en)
— is: "A new version of the European accessibility standard, EN 301 549 v4.1.1, was published in
September 2026. The biggest change is that it adopts WCAG 2.2 as the accessibility benchmark for
websites, software and digital documents. […] Until the European Commission formally cites EN 301
549 v4.1.1 in the Official Journal […] the current reference remains EN 301 549 v3.2.1." The W3C
puts the same mapping [plainly](https://www.w3.org/WAI/standards-guidelines/wcag/): the 2026 version
of EN 301 549 uses WCAG 2.2. (One caution: vendor materials sometimes cite "EN 301 548" as the EAA
standard. As of writing, ETSI's [standards shelf](https://www.etsi.org/deliver/etsi_en/301500_301599/)
for the 301 5xx series has no EN 301 548; the deliverable is EN 301 549. Verify any designation you
are asked to cite, against Official Journal listings, before relying on it.)

Whether your site is in scope, which deadlines apply to you, and whether you qualify for an
exemption are legal questions for the site owner's own advisor, and Seaworthy takes no position on
them. Nothing here should be read as: using this tool makes you compliant. It cannot — see the
previous section — and a report is not an "audit-ready" artifact in any legal sense. What a report
can do is what evidence is for: support a claim you have independently made, and expose what you
have not yet looked at.

## What to record in an accessibility statement instead

An accessibility statement is a claim by you. A Seaworthy report can sit under it as dated
evidence for the part you automated. What to record:

- **The report file itself**, produced on a stated date: `seaworthy verify --format json --out <file>`
  (the JSON is deterministic and versioned — `spec: 0`, `tool.version` as embedded at build time);
- **The flags used**, because they change what ran: a plain run is static-only; `--rendered` adds
  the axe pass (and say which browser); `--fail-on` records your gate, not the tool's;
- **The pinned version.** Seaworthy is pre-alpha: `@seaworthy/*` is not on npm and no release tag
  exists, so an install line must be a git pin you actually ran today —
  `npm install --no-save github:arminazimi/seaworthy#<full commit SHA>` placed *after* the site's
  own `npm ci` (which wipes it), or a `devDependencies` entry pinned to a commit. Record the
  commit SHA; `0.0.0` as a version number is not a pin;
- **Which checks ran and which did not**: the report's `checks` array lists every check that ran
  with the `standards` it cites; `skipped` lists what did not run and why. Copy both into the
  statement, or attach the report;
- **What stayed manual**, from the list above, with dates and who did it. A statement that
  automated checks "passed" while the keyboard pass was never done is a claim people can — and
  users will — falsify.

If you think a check got it wrong, or one is missing: the routes are open. Every check ID links to
a page under [`docs/checks/`](checks/README.md) that states its scope, a false positive is filed as
a [bug report](../.github/ISSUE_TEMPLATE/bug.yml), and a missing rule as a
[check proposal](../.github/ISSUE_TEMPLATE/check-proposal.yml).
