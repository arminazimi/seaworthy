# Triage board

How every incoming issue and PR gets decided, written down. Every label named
here exists in this repository; where a label is applied, this page says by
what. Seaworthy is pre-alpha ([AGENTS.md](../AGENTS.md)), so this is a small
board, not a support queue: there is no SLA, no on-call rota, and no promised
response time.

A GitHub Projects board is a repository setting, not a file: a maintainer has
to create the board and its columns by hand. This page is the file that
defines what those columns are and the exact label test that moves a card into
each one.

## Where feedback lands

| Kind of feedback | Route | Label it arrives with |
|---|---|---|
| A check reported something that is not a problem | `false-positive.yml` issue form (added by PR #525, linked from `.github/ISSUE_TEMPLATE/config.yml`) | `bug` |
| Seaworthy missed a real problem | `missing-check.yml` issue form (added by PR #525) | `enhancement` |
| Wrong output, crash, anything else broken | `bug.yml` issue form | `bug` |
| A new check or a change to one, rule and fix hint known | `check-proposal.yml` issue form | `enhancement` |
| A vulnerability | [SECURITY.md](../SECURITY.md) private reporting route, never a public form | — |
| A question | GitHub Discussions is disabled on this repo, so questions land as plain issues (`blank_issues_enabled: true` in `.github/ISSUE_TEMPLATE/config.yml`) | — |

## Who applies which labels

- **The roadmap tooling** ([planning/roadmap/labels.mjs](../planning/roadmap/labels.mjs), applied by `build.mjs` and pushed by `apply.mjs`) puts `roadmap` on every planned issue, plus its `area: …` label(s), `type: epic` or `type: task` with a prefix-derived type (`type: check`, `type: fixture`, `type: integration`, `type: docs`, `type: test`, `type: spike`, `type: preset`), `lane: strong-agent` / `lane: free-agent` / `lane: maintainer`, `size: XS` / `size: S` / `size: M`, `track: verify` for tier-1 work, `status: needs-brief` when a task has no agent brief, and `help wanted` on free-agent work (`good first issue` when it is also `size: XS` with a brief).
- **`tools/pr-conflict.mjs`** (run by `.github/workflows/conflict.yml`) adds `conflict` to any PR that stops merging cleanly and removes it when it merges again. No human touches this label.
- **`planning/roadmap/apply.mjs`** adds `moved: theme` when retiring a roadmap issue into the reference-theme project ([ADR 0009](adr/0009-theme-split-and-position.md)).
- **Issue forms** pre-attach `bug` or `enhancement` as in the table above.
- **A human triaging** uses only the rest: `duplicate`, `invalid`, `wontfix`, `question`, and `status: blocked`.

## The board, in column order

Column and its exact test (GitHub issue search; add `is:open` where relevant):

1. **Inbox** — `is:issue -label:roadmap`. Anything a human filed: forms and blank issues. Roadmap issues never appear here, so the inbox is only real feedback.
2. **Needs brief** — `label:"status: needs-brief"`. Roadmap tasks with no agent brief; the claimer must comment a plan first ([CONTRIBUTING.md](../CONTRIBUTING.md)).
3. **Ready** — `is:issue label:roadmap -label:"status: needs-brief" -label:"status: blocked"`. The `lane:` label says who takes it, the `size:` label says how long it should take.
4. **Blocked** — `label:"status: blocked"`. Blocked on an external dependency; unblock by removing the label, never by re-planning around it silently.
5. **In progress** — not a label: an issue claimed by assignment (`docs/agents-playbook.md`: "the assignment records the claim"), and PRs that are not `draft` and not `conflict`.
6. **Conflicts** — `is:pr label:conflict`. Machine-managed; a maintainer rebases, the workflow clears the label.
7. **Theme** — `label:"moved: theme"`. Belongs to the reference theme project now (ADR 0009); close as transferred or let the theme project track it.
8. **Done** — closed issues and merged PRs, plus closes carrying `duplicate`, `invalid`, or `wontfix`.

## The false-positive path

A report arrives via the false-positive form with `bug` and, by construction,
a check ID, a version, the report JSON, and a minimal repro.

1. Reproduce the reporter's command against the minimal repro. No repro, no
   fix: ask for one, and if none comes, close with `invalid`.
2. If the check is genuinely wrong, the repro becomes a fixture first: a built
   site under `fixtures/clean/<name>/site/` whose `expected.json` is
   `{ "findings": [] }`, or a `fixtures/broken/<name>/` case whose
   `expected.json` lists only the findings that are truly there ([fixtures/README.md](../fixtures/README.md)).
   Write it by hand from the site, never by pasting the engine's output.
3. Fix the check module in `packages/verify/src/checks/` and its page in
   `docs/checks/`; `npm test` runs the fixture suite, so the false positive is
   now a regression test.
4. If the finding was correct and the site intends that markup, point at the
   `<!-- seaworthy-ignore … -->` suppression (its syntax and failure modes are
   documented in [docs/checks/suppress.invalid.md](checks/suppress.invalid.md))
   and close normally; if the rule itself should change, that becomes the
   missing-check/check-proposal path below.

## The missing-check path

A report arrives via the missing-check form with `enhancement`, a one-sentence
failure mode, a real site or candidate fixture, the `html|files|browser|network`
it would need, and the closest existing check.

1. If an existing check nearly catches it, extend that check: a normal
   `type: check` issue in the right epic.
2. If it is a genuinely new check ID, it enters through `ROADMAP.md` — the
   roadmap is the source of truth for planned work ([ADR 0003](adr/0003-roadmap-as-source.md)),
   and `npm run roadmap:build` plus `apply.mjs` turn it into a labeled issue.
   Do not hand-create an issue and start coding.
3. A new check ships with ground truth, a doc page, and a generated registry:
   at least one broken fixture that triggers it, `docs/checks/<id>.md`, and
   `npm run build && node tools/gen-registries.mjs`. A check that would need
   the network or a browser is opt-in (trust rules, AGENTS.md).

## Changing this board

Columns and label tests change with a PR to this page; the labels themselves
change in `planning/roadmap/labels.mjs` (which `apply.mjs` syncs to GitHub),
never ad hoc in the repo settings.
