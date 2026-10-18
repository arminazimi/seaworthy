# 0010. Repository Markdown is checked by an opt-in package that reuses the core finding model

**Status:** Accepted (2026-10-18)

## Context

Seaworthy verifies built sites. Many broken links never reach a built site: they sit in `README.md` and `docs/*.md`, where GitHub renders them. Agents write a lot of Markdown, rename files, and change headings, and every rename can break a link or an anchor elsewhere. The roadmap has a Phase 6 epic for Markdown sources (`E-markdown`). Issue #215 asks how hard this is to do right and where it fits.

Questions:

1. Can a small program resolve links and heading anchors the way GitHub does, with no false positives on real repositories?
2. How fast is it?
3. What does it cost in dependencies, given that `packages/verify` has one runtime dependency (`parse5`)?
4. Should it be part of `verify`?

## Method

A throwaway prototype (about 80 lines, not in the repository) used `markdown-it` 14.1.0 to read each tracked `*.md` file as tokens and `github-slugger` 2.0.0 to compute heading anchors. It collected links and images from Markdown and from raw HTML (`href` and `src` attributes), then checked:

- relative paths, resolved from the file's folder, and paths starting with `/`, resolved from the repository root
- links that leave the repository (`../../x`)
- `#anchor` links against the headings and `id`/`name` attributes of the target file
- GitHub's line anchors (`#L10`, `#L10-L20`), accepted on any existing file
- external links, counted but not followed

Two runs: this repository's own 72 Markdown files, and a seeded 4-file repository with known good and bad links.

## Results

### This repository (72 files)

| Measure | Result |
| --- | --- |
| Links and images found | 138 (84 external, 54 checked) |
| Problems reported | 0 |
| Parse and check time (warm, M-series Mac) | 30 ms |

Zero problems is the right answer here: the roadmap and docs links were already verified by hand while writing them, and the seeded repository shows the checker is not blind.

### Seeded repository (30 links)

Every good link passed, and every bad one was found:

| Case | Result |
| --- | --- |
| Heading with punctuation, `&`, parentheses, and an emoji (`My Project: Tools & Tips (v2.0) 🚀`) | slug `my-project-tools--tips-v20-` matched GitHub |
| Repeated headings | second one is `-1`, as on GitHub |
| Setext headings, Persian headings, inline code in headings | matched |
| `<a name>` and `id` in raw HTML | counted as anchors |
| Reference-style links, links to folders, `%20` in paths, `#L3` on a file | accepted |
| Missing file, wrong `#anchor`, link outside the repository, missing image | each reported |
| Links in raw HTML (`<a href>`, `<img src>`) | reported once the HTML is read; Markdown parsing alone misses them |
| Root-relative `/docs/a.md` | resolved from the repository root; missing target reported |
| Anchor in different letter case (`#Setext-Heading`) | accepted; GitHub matches anchors without regard to case |

### Dependencies

`markdown-it` brings 6 packages (`argparse`, `entities`, `linkify-it`, `mdurl`, `punycode.js`, `uc.micro`); `github-slugger` has none. Together they are about 1 MB. `parse5` is already in the core.

## Decision

1. **Build it.** Resolving links and anchors the way GitHub does is small and reliable. Two details need care: the slug rules (use `github-slugger` rather than a copy) and raw HTML in Markdown (read `href` and `src`).
2. **Ship it as a separate, opt-in package** (`@seaworthy/markdown`), not inside `packages/verify`. Core keeps one runtime dependency. The package produces ordinary findings (`md.links`, `md.anchors`) through the same finding model, report, and SARIF output, so baselines, suppressions, and the Action work unchanged.
3. **Input is a folder or the tracked `*.md` files** (`git ls-files`), with no network. External links reuse the existing opt-in `links.external` probe.
4. **Findings point at the Markdown line.** Markdown tokens carry line numbers, so a fix lands in the source file, which is the file agents should edit. This is the first check that does not need a source map.
5. **Timing is unchanged.** The work stays in the Phase 6 `E-markdown` epic. It is a small epic, so if early users ask for it sooner it can move to Phase 3 without a redesign.

## Consequences

- Anchors are compared without regard to case, as on GitHub. This is more lenient than a static site, where fragments are case sensitive, so `links.internal` and `md.anchors` have different rules on purpose; both are documented.
- Only GitHub's rendering rules are covered. Other renderers (GitLab, Docusaurus, Jekyll) slug differently, so the package takes a `flavor` option, with `github` first.
- Not tested in this spike: Markdown inside code fences (should be ignored), footnotes, MDX, front matter, and links in `<details>` blocks. Each needs a fixture when the package is built.
- Comparison with `lychee` is left to the competitor spike (#212). It supports Markdown and fragments, and the aim of that comparison is to list what it misses, not to replace it.
