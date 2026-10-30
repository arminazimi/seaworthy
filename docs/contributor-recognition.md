# Contributor recognition

Recognition here means one thing: a public record of who did what, in this repository, that anyone can read afterwards. Every mechanism below already exists on `main`. Where something would have to be turned on by a maintainer first, this page says so instead of assuming it.

## What counts

Anything that merges counts, and the kind of work does not change the credit. The lanes in [CONTRIBUTING.md](../CONTRIBUTING.md) say who a task suits, not how valuable it is.

| Contribution | Where it lands |
| --- | --- |
| A check, a format, or an engine change | `packages/verify/src/`, plus its `docs/checks/<id>.md` |
| A fixture with ground-truth findings | `fixtures/` |
| A recipe for a generator or a host | `docs/` |
| A Skill | `skills/` |
| An MCP, CLI, or Action change that keeps the adapters thin | `packages/mcp/`, `packages/action/` |
| Triage, review, and repro steps in issues | the issue thread |

**Recognition follows merged work, not claimed issues.** A claim is recorded by assignment plus a plan comment ([docs/agents-playbook.md](agents-playbook.md), step 2); it shows intent. If a claim goes quiet for a week someone else takes the task and the credit with it.

## Where credit lives today

1. **The pull request.** One issue is one pull request, opened with `Closes #<issue>`, and [CONTRIBUTING.md](../CONTRIBUTING.md) asks you to say which agent you used. The [pull request template](../.github/pull_request_template.md) and step 6 of the playbook are where that attribution is written down, so the PR page is the complete record: the person, the agent, the plan comment, and the commands run.
2. **The git log.** Merge commit subjects carry the issue number, and often the pull request number next to it — `docs: add playbook for running many agents in parallel (#481) (#487)`. Whoever commits under their own identity is the commit author: two commits on `main` are authored by `yuefdev`, for `feat(verify): report untitled iframes (#384)` and `fix(sarif): encode native report paths (#385)`. Agent authorship is already recorded as a trailer — several commits carry `Co-authored-by: CommandCodeBot <noreply@commandcode.ai>`. Because the same person merges and commits here, read the pull request next to the log; the log alone is not the whole story.
3. **The changelog.** Every PR adds one fragment, `changelog.d/<issue>.<section>.md`, one paragraph ending with `(#<issue>)` ([changelog.d/README.md](../changelog.d/README.md)). `npm run check:changelog` validates the naming; `npm run changelog:fold` moves the fragments into the `## Unreleased` Added, Changed, and Fixed sections of `CHANGELOG.md` in issue-number order and deletes them, and maintainers run it before a release. A fragment credits the issue number, and the issue points back at the pull request that closed it, so the chain from a release note to the work is unbroken. There are no tags in this repository yet, so no release notes exist yet either; every merged contribution will appear in the notes of the first release that folds it.
4. **The roadmap.** `ROADMAP.md` is the source of truth for planned work ([ADR 0003](adr/0003-roadmap-as-source.md)), and `planning/roadmap/labels.mjs` defines the labels that show on every issue, including `lane: free-agent` ("Spec-complete: suitable for free agents and new contributors") and `area: community`. A closed issue with its task key is credit that survives a renamed branch or a deleted fork.

## Agent-authored work

This roadmap is worked by people and coding agents side by side — [AGENTS.md](../AGENTS.md) says so, and [docs/agents-playbook.md](agents-playbook.md) is the loop for running many agents without collisions. The honest description of what the repository does today:

- The agent is named in the pull request body, as `Written by a coding agent (<name>)`; two names appear in merged pull requests so far, Qoder and ZCode / GLM.
- The human who claimed the issue, pushed the branch, and answered review owns the contribution and is the one the git log and GitHub list as its author.
- Nothing about an agent-authored pull request is held to a different bar: same `npm run check` gate, same one-issue-one-PR rule, same fragment, same template.

An agent identity in a trailer or a PR body is a record of how the diff was written. It is not a project member, and no recognition described here transfers to it.

## How to make your work creditable

- Put `Closes #<issue>` in the PR body; an unlinked PR is invisible to the issue and to the roadmap.
- Add exactly one fragment, named `<issue>.<added|changed|fixed>.md`, ending with `(#<issue>)`.
- Say which agent you used, if any.
- Commit under an identity you control, if you want the git log to say so.

## What this page does not promise

- No money, no swag, no titles, no commit access. Recognition here is public credit and nothing else.
- No roles, no ownership, no path to becoming a maintainer. `GOVERNANCE.md` does not exist in this repository; that model is open issue #175 and this page does not pre-decide any part of it. Neither does it describe an RFC process — `rfcs/` does not exist yet either (open issue #174).
- No contributor tiers, points, or leaderboards. `ROADMAP.md` tracks external contributors as a metric of the project's reach, not as a reward to hand out.
- No code of conduct text: [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) is the policy and applies to this page like everything else here.
- No agreement to a contributor licence agreement, because this repository has none: it is Apache-2.0 and `LICENSE` states what each Contributor grants.

## If a generated contributors list is wanted later

That is a maintainer decision, not something a documentation pull request should configure, so this PR adds no app, no workflow, and no list file. What turning it on would take, stated plainly:

1. Pick the source of truth. GitHub's own contributor list is derived from commit authorship, which undercounts documentation, triage, and fixture work and splits one person across several email identities — this repository has three author identities for the maintainer plus a bot trailer, so a naive list is wrong on day one.
2. Decide who may edit the resulting file. If humans edit it, it drifts; the repository's own convention for a file several pull requests would touch is that it is generated and never hand-edited ([AGENTS.md, shared files](../AGENTS.md#shared-files-append-only-regenerate-or-never-touch)).
3. Add the generator and, if it must run on a schedule, the workflow — and then a `README` note in `AGENTS.md`'s layout table so the next contributor knows which rule applies to it.

Until someone does that, the answer to "who contributed" is the pull request list, the git log, and the changelog. All three are already here and all three are the record this page describes.
