# GitHub Action

`action.yml` at the repository root is a composite GitHub Action: it builds Seaworthy from the
Action's own checkout, verifies the built site in your workspace, writes SARIF when you ask for it,
and fails the run at your threshold. The logic is not in the Action — `packages/action` is a thin
adapter over the verify API, and every rule lives in `@seaworthy/verify`
([ADR 0008](adr/0008-sarif-locations.md) is the single authority for SARIF).

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `site` | `""` | Built site folder, relative to the workspace. Empty lets the CLI pick the first existing of `dist`, `build`, `out`, `public`, `_site`, `site`. |
| `threshold` | `error` | Severity that fails the run: `error`, `warning`, `note`, or `none`. Travels to the CLI as `--fail-on`, so the CLI decides the exit code. |
| `sarif` | `""` | Where to write the SARIF 2.1.0 report, relative to the workspace. Empty disables SARIF. |

The run exits with the CLI's contract: `0` ok, `1` findings at or above the threshold, `2` a usage
or input error, `4` a check crashed. The `sarif` output echoes the `sarif` input, `""` when disabled.

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

Pre-alpha (Phase 2, action epic #9). The `sarif` and threshold paths are wired in `action.yml`; the
pull-request comment steps are exposed by `prCommentSteps` for the workflow to call, and the badge is
a committed SVG rather than a hosted endpoint.
