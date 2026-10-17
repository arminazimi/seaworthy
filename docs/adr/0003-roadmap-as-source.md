# 0003. ROADMAP.md is the source of truth for planned work

**Status:** Accepted (2026-10-17)

## Context

Work is split into small issues so contributors and coding agents can each take one. Keeping a roadmap document and hundreds of issues in sync by hand drifts quickly. Evergreen solved this by generating issues from data files; here the roadmap was written first as Markdown tables.

## Decision

- `ROADMAP.md` is the single source. `planning/roadmap/build.mjs` parses its phases, epics, and task tables, validates them (unique keys, known dependencies, lanes, sizes), and writes issue bodies to `planning/roadmap/out/`.
- Detailed agent briefs (files, steps, done-when) live in `planning/roadmap/briefs/<task-key>.md` and are merged into the matching issue. A task without a brief is still created, and its issue asks the contributor to post a plan first.
- `planning/roadmap/apply.mjs` syncs the output to GitHub. It is a dry run unless called with `--apply`, and it is idempotent: issues are matched by a hidden roadmap-key marker.
- `npm run check` fails if `ROADMAP.md` stops parsing or validating.

## Consequences

- Planning changes are reviewed as normal PRs to one file.
- Briefs can be written just in time, phase by phase.
- The parser depends on the table format in `ROADMAP.md`; the check catches format drift.
