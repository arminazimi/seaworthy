# 0007. Prior art: what to reuse, wrap, or build

**Status:** Accepted (2026-10-17)

## Context

Before writing the engine we need to know what already exists, so Seaworthy reuses good pieces and is clearly different from existing tools. The questions: which tools check static sites today, what do they output, are agents able to use that output, and can we depend on them (license, maintenance, weight)?

## Method

Read each tool's README or documentation on 2026-10-17, and checked repository activity with the GitHub API and release history with `npm view`. We did **not** install or run the tools, so "not documented" below means the README does not say so, not that the tool cannot do it. Install sizes for `axe-core`, `playwright-core`, `jsdom`, and `lighthouse` come from ADR 0005.

## What exists

| Tool | Checks | Machine-readable output | Locations | License | Maintenance |
| --- | --- | --- | --- | --- | --- |
| [html-proofer](https://github.com/gjtorikian/html-proofer) | Links, anchors, images (alt, broken), scripts, favicons, Open Graph | Ruby `Failure` objects and custom reporters; no JSON documented | Line number per failure | MIT | Repo pushed 2026-10-16; Ruby gem |
| [lychee](https://github.com/lycheeverse/lychee) | Links and fragments; can check local HTML offline | `json`, `junit`, `markdown`, `compact`, `detailed`; no SARIF | Not documented | Apache-2.0 | Repo pushed 2026-10-13; Rust binary |
| [linkinator](https://github.com/JustinBeckwith/linkinator) | Links, fragments, CSS URLs, JSON-LD; serves a local folder itself | `json`, `csv` | Parent page; no line documented | MIT | `linkinator` 8.1.0, published 2026-08-29 |
| [pa11y](https://github.com/pa11y/pa11y) | Accessibility via HTML_CodeSniffer or axe | `cli`, `csv`, `html`, `json`, `tsv`; no SARIF | CSS selector and context | LGPL-3.0 | `pa11y` 10.0.0, published 2026-08-28; depends on Puppeteer |
| [@axe-core/cli](https://github.com/dequelabs/axe-core-npm) | axe on a few URLs; "not a crawler" | JSON with a `violations` list | Selector and HTML snippet (from axe's own result, which our prototype in ADR 0006 used) | MPL-2.0 | `@axe-core/cli` 4.14.0, published 2026-10-15; needs a browser and webdriver |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | Lighthouse audits with assertions and budgets; can serve a built folder and discover pages (default cap 5) | Lighthouse JSON plus a `manifest.json`; no SARIF documented | Per URL | Apache-2.0 | Repo pushed 2026-10-17, but `@lhci/cli` 0.15.1 was published 2025-06-25 |
| [webhint](https://github.com/webhintio/hint) | Broad best-practice hints | Formatters exist; formats not confirmed | Not confirmed | Apache-2.0 | Repo pushed 2026-07-21, but `hint` 7.1.13 was published 2024-08-29 |
| `llms.txt` validators | Structure of `llms.txt` | Web forms; the open-source repos found have 0 to 1 stars | Line numbers on one web tool | n/a | The web tools disagree on whether absolute URLs and the blockquote are required |

What we found across the set:

- **None of the documented outputs is SARIF.** None documents a baseline (html-proofer has ignore options; linkinator has skip patterns), and none documents a fix hint an agent can apply.
- **Each tool checks one slice** (links, or accessibility, or performance) and prints for a person. An agent running several of them gets several formats with no shared IDs or fingerprints.
- **Several are heavy or foreign to a JS toolchain:** html-proofer needs Ruby, lychee ships a Rust binary, pa11y pulls in Puppeteer, and Lighthouse installs 179 MB.
- **For `llms.txt` there is no maintained open-source checker.** The format is a community proposal, and the existing validators contradict each other.

## Decision

| Capability | Decision | Why |
| --- | --- | --- |
| HTML parsing and site graph | **Build** on `parse5` (MIT, 0.9 MB) | No tool exposes a reusable graph; we need source positions and one parse shared by all checks (ADR 0006). |
| Internal links and anchors | **Build** | Cheap on the graph. We need exact line and column, a fingerprint, and a fix hint (the closest existing page), which none of the tools documents. |
| External links | **Build**, opt-in, on Node's `fetch` | A small amount of code, and no extra dependency. Copy behaviors the existing tools learned: a cache with a maximum age (lychee), checking fragments only on `GET` (lychee), and skipping bot-protection responses such as 403 with `cf-mitigated` and 999 (linkinator). Revisit wrapping lychee if accuracy proves hard. |
| Images, meta, headings, names, sitemap, robots | **Build** | Simple rules on the graph. |
| Accessibility | **Reuse `axe-core` directly** (MPL-2.0) through `playwright-core` (ADR 0005) | pa11y and `@axe-core/cli` only wrap axe, add a browser dependency or a webdriver, and pa11y is LGPL-3.0. Using axe itself keeps its rule IDs and gives us the selector and snippet. |
| Lighthouse | **Reuse `lighthouse`** (Apache-2.0) as an optional engine; do not use `@lhci/cli` | We need only the audits, not LHCI's server, assertions file, or upload targets, and its last npm release is 16 months old. Borrow its ideas: serve the folder over loopback HTTP, discover a few pages, assert by audit ID and minimum score, and aggregate several runs by median. |
| `llms.txt` and agent readability | **Build**, with rules written down | No maintained tool exists. `readability.spec` must state each rule, its severity, and whether the proposal requires it, so we do not copy the validators' disagreement. |
| SARIF, baseline, fix hints, one report | **Build** | This is the gap in the table above, and it is what makes Seaworthy usable by agents. |
| webhint | **Do not depend on it** | The repository is active but the npm package has had no release since 2024. Reconsider if releases resume. |

**Licenses.** Everything we depend on is compatible with Apache-2.0: `parse5` (MIT), `playwright-core` and `lighthouse` (Apache-2.0), and `axe-core` (MPL-2.0, used unmodified, listed in `NOTICE`, never copied into the repository). We avoid depending on pa11y (LGPL-3.0).

**How Seaworthy is different**, for the README and launch posts: existing tools each check one slice and print for humans; Seaworthy runs links, structure, accessibility, performance, and agent-readability checks in one command and returns one versioned report with stable check IDs, exact locations, fingerprints, a machine-readable fix for each finding, SARIF, and a baseline, across any static-site generator.

## Consequences

- **Claims are limited to documentation.** Before the launch post says "no other tool does X", test the specific tool; `launch1.top100` and the README task should link evidence.
- **`check.links-external` carries the most reuse risk.** Link checking has years of edge cases (redirects, rate limits, bot walls) that lychee has already met. If our checker produces false positives in beta, wrap lychee as an optional engine instead of extending ours.
- **The `llms.txt` check is also a product.** With no maintained open-source checker, a good one is a reason to try Seaworthy; `check.llms-txt` should be written carefully and documented.
- **Dependency list for v0.1:** `parse5` (required), `playwright-core` and `axe-core` (optional peers, ADR 0005), `lighthouse` (optional, opt-in check). Nothing else without a stated reason in its PR.
