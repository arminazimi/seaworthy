# md.anchors

A link in a Markdown file points at a `#heading-anchor` that no heading in the file it links to has.

## Why it matters

Documentation is read by jumping to an anchor: an agent takes `[Install](docs/guide.md#install)`, and on GitHub that jump is the whole point of the link. A heading that is renamed, reworded, or removed silently breaks every link to it, and so does a heading that stops being a duplicate, because GitHub numbers repeated headings `install`, `install-1`, `install-2` and drops the number when there is only one copy left. The link still looks right, the file still exists, and only the anchor is gone: a dead end in the middle of the docs.

## What it checks

Every Markdown file (`*.md`, `*.markdown`) under the verified root is read into the Markdown graph, and each link that carries a `#fragment` is resolved to a Markdown file in that graph. Anchors follow GitHub's slug rules (the same ones `markdown.ts` implements): lowercase, punctuation stripped, each space a dash, and repeated headings suffixed `-1`, `-2`, … Anchors are compared **without regard to case**, as GitHub does (ADR 0010), so `#INSTALL` reaches the `## Install` heading. Percent-encoded fragments (`#%69nstall`) are decoded first. A link with only a fragment (`#install`) points at its own file and is checked against that file's headings.

The check fails when the target file is in the graph and none of its headings has that anchor.

Skipped on purpose:

- Links whose target file does not exist — that is `md.links`' finding, so one dead link yields one finding.
- External links (`http:` and friends) and `mailto:`/`tel:`/`data:` links; a fragment on a file outside the graph (`src/app.ts#L10`) is not this check's either.
- An empty fragment (`docs/guide.md#`).
- Anchors that a Markdown file's raw HTML gives an element with `id` or `name`: the graph indexes headings only, so those are not known anchors yet.

The location is the Markdown line itself, never a guessed column, because the graph parses the link out of the source line. The check needs no browser and no network, and an HTML-only site with no Markdown files reports nothing.

## How to fix

```markdown
<!-- before: the heading below was renamed from "## Install" and the -1 is left over -->
[Install steps](docs/guide.md#install-1)

<!-- after -->
[Install steps](docs/guide.md#install)
```

When one heading in the target file differs from the missing anchor only by that uniqueness suffix, the report carries an exact text edit for it and keeps the link's style (relative or root-absolute) as written. Otherwise the fix is `manual` and only names the options: the closest anchors in the file, and, when the anchor exists in another Markdown file, that file — Seaworthy reports and suggests, it never rewrites the link target for you.

## Options

None.

## Standards

None.
