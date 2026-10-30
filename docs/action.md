# GitHub Action

`action.yml` at the repository root is a composite GitHub Action: it builds Seaworthy from the
Action's own checkout, verifies the built site in your workspace, writes SARIF when you ask for it,
annotates the pull request's own files, and fails the run at your threshold. The logic is not in the
Action — `packages/action` is a thin adapter over the verify API, and every rule lives in
`@seaworthy/verify`
([ADR 0008](adr/0008-sarif-locations.md) is the single authority for SARIF).

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `site` | `""` | Built site folder, relative to the workspace. Empty lets the CLI pick the first existing of `dist`, `build`, `out`, `public`, `_site`, `site`. |
| `threshold` | `error` | Severity that fails the run: `error`, `warning`, `note`, or `none`. Travels to the CLI as `--fail-on`, so the CLI decides the exit code. |
| `sarif` | `""` | Where to write the SARIF 2.1.0 report, relative to the workspace. Empty disables SARIF. |
| `annotations` | `auto` | Inline pull-request annotations: `auto` annotates findings the pull request can be shown on, `off` writes no workflow commands. |

The run exits with the CLI's contract: `0` ok, `1` findings at or above the threshold, `2` a usage
or input error, `4` a check crashed. The `sarif` output echoes the `sarif` input, `""` when disabled.

## Inline pull-request annotations

`packages/action/src/annotations.ts` turns findings into GitHub workflow commands
(`::error file=…,line=…::message`) on the `Verify the site` step's own stdout, so they show up on the
pull request's Files tab. The commands need no permission, no uploader, and no network, which is why
this route and not a SARIF upload: the SARIF path stays as it was (`sarif` input plus the artifact
step) and answers a different question — a code-scanning alert that outlives the run.

The Action stays a thin adapter: the report's own severities, messages, files and lines travel
untouched, and the only thing this package adds is what only the runner knows — whether that file and
line exist in this checkout.

**A finding is annotated inline only when all four hold** (anything else goes to the summary channel,
the step summary when the runner gives one and the step log otherwise, so no finding is dropped):

1. **It has a real line.** `location.line` is a whole number of at least 1. A page-level finding and a
   rendered finding located by `selector` alone (`a11y.axe`) are never pinned to line 1.
2. **The pull request touched the file.** The repository path — the report root joined with the
   site-relative file, the same join the SARIF mapping uses minus its URI encoding — appears in
   `git diff --name-only <base>...HEAD`. The three-dot range means files another pull request changed
   on the base branch are not blamed on this one, and a file the author never opened stays quiet.
   `GITHUB_BASE_REF` is empty outside pull-request events, so a push or schedule run writes no
   annotations at all; a shallow checkout that holds neither `<base>` nor `origin/<base>` says so in
   the summary and asks for `fetch-depth: 0`.
3. **The line is in the checked-out file.** The path resolves inside the workspace, is readable, and
   the line number is within the file's lines. A line is never guessed, so a finding about output whose
   source is not in the repository (the usual case: build folders are not committed) is summarized.
4. **It fits the budget.** At most `MAX_ANNOTATIONS` (50) inline annotations per run, errors first, then
   warnings, then notes; the rest are counted in the summary as past the budget. A broken site reports
   hundreds of findings and a person reads none of them on one diff.

Severity mapping follows the report contract (`packages/verify/src/types.ts`) and adds nothing:
`error` → `::error`, `warning` → `::warning`, `note` → `::notice`. Values are escaped the way the
runner expects — `%` → `%25`, `\r` → `%0D`, `\n` → `%0A` in the message, plus `]` → `%5D` and
`:` → `%3A` in the `file=` value — so a finding message cannot open a second command or move a
parameter, and one command is always exactly one line.

Annotations never change the verdict: the exit code is the CLI's own, `threshold: none` still
annotates, and `threshold: error` annotates the warnings it does not fail on.

## The pull-request comment

`packages/action/src/pr-comment.ts` builds the comment body from two report files using the
engine's own diff (`readReport` + `diffReports` + `formatDiffComment`) — counts first, then the new
findings, then the fixed ones — and ends every body with the `<!-- seaworthy:pr-comment -->` marker
so a workflow can update its own last comment instead of posting again. A second step posts the body
with `gh pr comment`.

## The trend over the last runs

Alongside the diff, the comment shows how the site has been doing (issue #375, `trends.pr-comment`).
The numbers are the run summaries `seaworthy verify` already records in `.seaworthy/history`
([Run history](configuration.md#run-history)); the Action only reads them, with `readHistory`, and
renders them as one severity table above the marker, oldest run first:

```markdown
**Trend over the last 3 comparable runs (same configuration), oldest first**

| Date | Findings | Errors | Warnings | Notes |
| --- | --- | --- | --- | --- |
| 2026-03-01 | 12 | 2 | 7 | 3 |
| 2026-03-02 | 9 | 1 | 6 | 2 |
| 2026-03-03 | 8 | 1 | 5 | 2 |
```

The rules, all of them visible in `packages/action/src/trend.ts`:

- **Comparable means same configuration.** Each history record carries `configHash`, a hash of the
  settings that produced the run. The newest usable record stands for the current run, and only runs
  with **its** `configHash` are rendered: a run that verified a different check set measured
  something else, so it is dropped rather than plotted next to its neighbours.
- **No history, no trend.** A runner with no `.seaworthy/history` — a single-run job, or one that
  ran with `--no-history` — gets exactly the comment body it got before trends existed, byte for
  byte. Fewer than two comparable runs is treated the same way: one run has nothing to trend against.
- **A damaged store is skipped, never fatal.** A record that cannot be parsed, carries no
  `configHash`, or has no ISO-8601 timestamp is left out, like the reader leaves out the leftovers of
  a crashed run. The comment still posts.
- **At most 10 runs** (`TREND_RUNS`), the newest ones, and the store itself keeps only the last 30.
- **Deterministic output.** Dates are the UTC date part of the stored timestamp (`2026-03-01`), never
  a local-time rendering, and the runs keep the store's own order — the same history always builds
  the same bytes.

Nothing is added to `action.yml` for this: the trend reads the store in the workspace the Action
already verifies, and the comment body is built by the `body` step that issue #89 shipped.

## Status badge

The badge that shows the same report in a README is documented in [docs/badge.md](badge.md).

## Status

Pre-alpha (Phase 2, action epic #9). The `sarif`, threshold and `annotations` paths are wired in
`action.yml`, which is used by commit pin (`uses: arminazimi/seaworthy@<commit>`) because no tag or
published package exists yet; the pull-request comment steps are exposed by `prCommentSteps` for the
workflow to call, and the badge is a committed SVG rather than a hosted endpoint.
