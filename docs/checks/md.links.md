# md.links

A link in a Markdown file points at another file that does not exist in the Markdown sources.

## Why it matters

Markdown sources are the documentation an agent follows: it reads `README.md`, takes a link, and lands on nothing. Links that break in Markdown often never reach the built site at all, so the HTML checks cannot see them. Renames and moves are the usual cause, and every one of them is a dead end for whoever follows the link next.

## What it checks

Every Markdown file (`*.md`, `*.markdown`) under the verified root is read into the Markdown graph, and each of its links is resolved the way GitHub resolves it: relative paths from the file's folder, `/root`-absolute paths from the root, inline, reference, shortcut, and autolink forms, percent-encoding, and `?`/`#` suffixes. The check fails when a resolved internal target matches no Markdown file in the graph.

Skipped on purpose: external links (`http:` and friends, covered by `links.external`), `mailto:`/`tel:`/`data:` and empty hrefs, and fragment-only links (`#install`), whose target file is the current file. Links that resolve to a file inside the graph pass, even when the same link would also be visible to an HTML check.

The location is the Markdown line itself, so the fix lands in the source, not in built output. The check never uses the network, and an HTML-only site with no Markdown files reports nothing.

## How to fix

```markdown
<!-- before: docs/guide.md was renamed, this link still says doc/ -->
[Outdated](../doc/guide.md)

<!-- after -->
[Outdated](docs/guide.md)
```

When exactly one Markdown file in the graph has the missing target's basename (ignoring case), the report carries an exact text edit to repoint the link, keeping any `#fragment` and the style (relative or root-absolute) of the original. Otherwise it says which file is missing and leaves the choice to you: write the file or fix the link. **Fix the Markdown source**; a link only the build tool resolves (to a template, a page bundle) is a false positive worth reporting.

## Options

None.

## Standards

None.
