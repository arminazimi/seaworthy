# Checks

One page per check, named by its ID: `docs/checks/<check-id>.md`. A check's `meta.docs` URL points here, and `npm test` fails if a built-in check has no page.

The pages in this folder are hand-written prose. `docs/checks/reference/` holds a generated reference page per check — the catalog metadata composed with the prose below it — and is owned by `npm run reference:build`; never write there by hand.

Write each page with these sections:

```markdown
# links.internal

One sentence: what this check reports.

## Why it matters
Who is hurt when this is wrong, with real consequences.

## What it checks
The exact rule: when it passes and when it fails. Name the standard if there is one.

## How to fix
Before and after examples an agent can copy. Say what to change in the source, not only in the built output.

## Options
Config options under `checks."<id>".options`, or "None".

## Standards
Links, such as WCAG success criteria.
```
