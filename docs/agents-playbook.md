# Running many agents in parallel

Seaworthy is built for many agents at once. The rules below keep PRs
independent: two PRs that touch the same file, branch, or checkout collide.

## The loop

### 1. Pick an issue whose dependencies are closed

Read the issue and check that everything under **Depends on** is closed. Its
`lane:` label says who it suits; `size:` says how long it should take. An issue
with no detailed **Agent brief** needs a plan comment before any code.

### 2. Claim it by assignment

```bash
gh issue edit <n> --add-assignee @me
gh issue comment <n> --body "Files: ... Steps: ... Verification: ..."
```

The assignment records the claim. If you go quiet for a week, someone else may
take it over. `gh issue comment` prints the URL: keep it for the PR body. The
plan bounds the PR; if the work is bigger, open a follow-up issue instead.

### 3. Create one worktree per issue and install

From the main checkout, which stays on `main` and clean:

```bash
git fetch origin
git worktree add ../seaworthy-<issue> -b agent/<issue>-<slug> origin/main
cd ../seaworthy-<issue>
npm ci
```

Requires Node.js 22 or newer. One worktree and branch per issue keeps a build,
checkout, or rebase from disturbing another. Never work on `main`, reuse a
branch for a second issue, or switch branches inside another agent's worktree.
Worktrees share the git object store but not `node_modules`, so each needs its
own install; run builds, tests, and commits only in the issue's worktree.

### 4. Stay inside the brief and the shared-file rules

Touch only the files the brief lists. One issue is one pull request: when you
find more work, open a follow-up issue instead of growing the diff.

Never hand-edit the shared or generated files. [AGENTS.md](../AGENTS.md#shared-files-append-only-regenerate-or-never-touch)
gives the rule for each: append-only, regenerate, or never touch. Add a new
module rather than edit a shared index, and run the generator rather than
resolve a generated file by hand. `CHANGELOG.md` is never touched. Add one
changelog fragment as `changelog.d/<issue>.<section>.md`, where `<section>` is
`added`, `changed`, or `fixed`: one paragraph, no leading `- `, ending with
`(#<issue>)` (see [changelog.d/README.md](../changelog.d/README.md)). One
fragment per PR keeps two PRs from conflicting on the changelog.

### 5. Rebase, check, push

```bash
git fetch origin
git rebase origin/main
npm run check
git push -u origin HEAD
```

`npm run check` is the gate CI runs; it must pass before review. Rebasing before
the push puts your commits on top of current `main`, so the PR shows only your
change. If a rebase after review rewrites pushed commits, update only your own
branch:

```bash
git push --force-with-lease
```

Never force-push a branch you did not create.

### 6. Open a small PR

```bash
gh pr create --base main --title "<type>: <summary> (#<issue>)" --body "..."
```

Keep the body complete:

- `Closes #<issue>` and a link to the plan comment
- the commands you ran (`npm ci`, `npm run check`)
- the agent you used, e.g. "Written by a coding agent (Qoder)"
- the filled-in [pull request template](../.github/pull_request_template.md)

Small PRs merge quickly; a PR that fixes a second issue or reformats unrelated
files waits for review and conflicts with everyone behind it.

## When things go wrong

**Your PR conflicts.** Rebase it:

```bash
git fetch origin && git rebase origin/main
npm run check && git push --force-with-lease
```

Resolve generated-file conflicts by running the generator, not by hand. If the
branch is not yours, do not push at all: comment with the conflicting files and
let its author rebase it.

**A check is flaky.** Re-run the failing gate once on an idle machine: the whole
`npm run check`, or just that gate (for example `npm run check:startup`). If it
passes, say so in the PR. If it fails again, report the command and full output
in the PR and on [#479](https://github.com/arminazimi/seaworthy/issues/479); do
not disable or loosen the gate in your PR.

**A worktree is finished.** After the branch merges, remove it from the main
checkout:

```bash
git worktree remove ../seaworthy-<issue>
git worktree list
```

Removing the worktree does not delete the merged branch, locally or on the
remote.
