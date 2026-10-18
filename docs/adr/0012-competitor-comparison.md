# 0012. What squirrelscan, pa11y, lychee, and Cloudflare Agent Readiness find and miss on our fixtures

**Status:** Accepted (2026-10-18)

## Context

ADR 0009 positions Seaworthy against squirrelscan, Cloudflare Agent Readiness, lychee, and pa11y from their documentation. Any public claim of the form "only Seaworthy does X" needs a test behind it, and the roadmap makes a public benchmark a launch requirement. Issue #212 asks us to run the tools on our fixtures and write down what each finds and misses.

This ADR is the first, small version of that comparison. It is honest about what it can and cannot show.

## Method

- **Corpus:** the 24 broken fixtures in `fixtures/broken/` that need no config, plus `fixtures/clean/minimal`. Each was copied, given one extra page (`__all.html`) that links to every page so crawling tools can reach them, and served from a local static server.
- **Tools and versions:** squirrelscan 0.0.117 (`--offline --no-publish`, 50-page cap, external links off), pa11y 9.0.0 (axe and HTML_CodeSniffer runners, an installed Chrome, every page), lychee 0.24.2 (`--offline --include-fragments`, on the folder), and Seaworthy at this commit.
- **Ground truth:** each fixture's `expected.json`, written by reading the HTML. A problem counts as found when the tool reports a rule of the right kind on the right page. Matching is by page, not by element, because squirrelscan reports pages and ids, not lines. The rule mapping is in the table below and is judgement; a different mapping moves a few cells.
- **Cloudflare Agent Readiness** was not run. It scores a public URL and our fixtures are local. Its documented checks (Markdown for agents, Content Signals, agent skills index, MCP server card, and similar) are a different layer from page-level correctness, and ADR 0009 already lists them.

The raw output files were throwaway and are not in the repository.

## Results

### What each tool found on the problems the fixtures target

49 problem pages in total.

| Problem group | Problems | Seaworthy | squirrelscan | pa11y | lychee |
| --- | ---: | ---: | ---: | ---: | ---: |
| Links and assets | 2 | 2 | 2 | 0 | 2 |
| Images and names | 6 | 6 | 5 | 4 | 0 |
| Page metadata (title, description, lang, viewport, canonical, headings, social) | 18 | 18 | 17 | 9 | 0 |
| Site files and security (sitemap, robots, links to new tabs, mixed content) | 7 | 7 | 5 | 0 | 0 |
| Static accessibility rules | 16 | 16 | 12 | 12 | 0 |
| **All** | **49** | **49** | **41** | **25** | **2** |

**Seaworthy's column is true by construction.** The fixtures were written to exercise Seaworthy's own checks, so it finds all of them. This table says nothing about Seaworthy's quality. It shows what the other tools miss on these problem classes, and it cannot show what they find that Seaworthy does not.

### What the other tools missed

| Tool | Missed on these fixtures |
| --- | --- |
| squirrelscan | ARIA references to ids that do not exist, radio groups without a group label, skip links, oversized images, links to new tabs without `rel`, mixed content, `og:image` URLs |
| pa11y | everything outside accessibility (links, images' size and dimensions, canonical, description, viewport, sitemap, robots, social, security), plus invalid `autocomplete`, empty headings, skip links, and the `h1` rule at its default settings |
| lychee | everything except broken links and anchors, which it reports well and with line and column |

### What the other tools found that Seaworthy does not (yet)

Across the 25 runs squirrelscan reported 112 distinct rules. Most are outside the problem classes in the fixtures: performance hints (LCP, layout shift), schema markup, URL style, content length, E-E-A-T and legal pages, security headers, `llms.txt` and Markdown responses, `security.txt`. pa11y reported `color-contrast` and `region` from a real browser. lychee checks external links over the network. Seaworthy has no check for these today; some are on the roadmap (rendered layout, live-site and hosting checks) and some are policy opinions we will leave out.

### Noise on a correct site

`fixtures/clean/minimal` is a small site every Seaworthy check accepts.

| Tool | Findings on it |
| --- | --- |
| Seaworthy | 0 |
| lychee | 0 |
| pa11y | 3 warnings (HTML_CodeSniffer notices about list markup) |
| squirrelscan | 19 (2 errors, 15 warnings, 2 notes). The errors are a 24-character meta description (squirrelscan's length rule) and a sitemap that names `example.test` while the site is served from `127.0.0.1`, which comes from our local setup. The warnings are mostly SEO, E-E-A-T, and security-header policy |

Neither is a bug. squirrelscan scores a site as a whole against SEO and content policy; a CI gate on correctness would turn most of those rules off.

### How the tools differ in what they hand back

| | Seaworthy | squirrelscan | pa11y | lychee |
| --- | --- | --- | --- | --- |
| Input | built folder (offline) | live URL, local or remote | live URL | folder or URL |
| Where a finding points | file, line, column | page and an id or URL; no line | selector and HTML snippet | file, line, column |
| Stable rule IDs and fingerprints | yes | rule IDs | rule codes | status text |
| A fix | exact text edits, tested | text advice | none | none |
| SARIF, baseline, expiring suppressions | yes | no | no | no |
| Median time per fixture (3 pages) | 0.14 s | 0.59 s | 3.5 s | 0.01 s |
| Install | one npm package, 1 dependency | 70 MB package plus 88 MB local database after 25 runs | pulls Puppeteer; we used an installed Chrome | 23 MB binary |
| Leaves the machine | never | publishes to a hosted report page by default when signed in; `--offline` turns it off | no | only for external links |

## Decision

1. **Public comparisons say what this table supports and no more.** Allowed: "On the fixtures in `fixtures/broken/`, squirrelscan, pa11y, and lychee do not report X." Not allowed: any claim of overall coverage or quality, and any claim from a table whose ground truth is our own fixtures without saying so.
2. **The launch benchmark needs an outside corpus.** A set of real sites, or pages built by agents (the case ADR 0009 is about), labeled by someone other than the tool author, with element-level matching. The fixtures cannot support a recall claim for Seaworthy.
3. **Positioning stays as in ADR 0009**, with one correction in emphasis: squirrelscan covers more accessibility rules than its description suggests (it runs an axe-style rule set over plain HTTP responses). The durable differences are the ones in the last table: a built folder before deploy, a line and column in the source, tested edits, SARIF and baselines, and nothing leaving the machine.
4. **Two checks to consider from this comparison:** a `region`-style check for content outside landmarks (pa11y's axe rule fired 64 times on our fixtures, mostly noise on tiny pages, so it needs a threshold), and `color-contrast`, which is already planned for the rendered tier. Autoplay of audio is covered by `a11y.media-captions`.

## Consequences

- The corpus, benchmark, and comparison page are the tasks that turn this into public claims: `bench.corpus`, `bench.competitors`, and `docs.compare` in Phase 3. Their wording has to follow decision 1.
- The comparison scripts are not in the repository. `bench.competitors` should keep its own as a script under `tools/` so others can rerun it.
- Cloudflare Agent Readiness stays unmeasured until there is a public fixture site to point it at.
