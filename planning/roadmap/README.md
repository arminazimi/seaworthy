# Roadmap tooling

Turns [`ROADMAP.md`](../../ROADMAP.md) into GitHub issues, epics, labels, and one milestone per phase. `ROADMAP.md` is the source of truth ([ADR 0003](../../docs/adr/0003-roadmap-as-source.md)).

| File | Does |
|---|---|
| `parse.mjs` | Reads phases, epics, and task tables from `ROADMAP.md` |
| `labels.mjs` | Label definitions, lanes, sizes, and area labels per epic |
| `briefs/<key>.md` | Optional detailed agent brief for one task |
| `status.mjs` | Tasks already finished before their issues existed |
| `build.mjs` | Validates everything and writes `out/` (issues, labels, preview) |
| `apply.mjs` | Syncs `out/` to GitHub; dry run unless `--apply` |

## Use

```bash
npm run roadmap:build        # validate and write out/preview.md
npm run roadmap:apply        # dry run: print what would change on GitHub
node planning/roadmap/apply.mjs --apply   # maintainers only: create and sync issues
```

`npm run check` runs `build.mjs --check`, so a malformed `ROADMAP.md` fails CI.

## What the build checks

- Every epic has a key, an outcome, tasks, and area labels.
- Every task has a known lane (`strong-agent`, `free-agent`, `maintainer`) and size (`XS`, `S`, `M`).
- Every dependency names an existing task, and there are no cycles.
- Every brief and every entry in `status.mjs` matches a task.

## Labels the build adds

- `type: epic` or `type: task`, plus a type from the key prefix (`check.` → `type: check`, `int.` → `type: integration`, and so on)
- Lane, size, track, and the epic's areas
- `status: needs-brief` on non-maintainer tasks without a brief
- `help wanted` on `free-agent` tasks; `good first issue` on `free-agent` `XS` tasks that have a brief
