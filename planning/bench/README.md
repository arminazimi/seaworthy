# Benchmark task suite

The tasks the agent-success benchmark (ROADMAP epic `E-agent-bench`) runs, defined once with
machine-checkable success criteria. Issue #101 (`bench.tasks`) produced this suite; executing it
and scoring agents is `bench.runner` (#102), which consumes the contract below and owns nothing here.

## What "machine-checkable" means in this folder

A criterion is machine-checkable only if a command with a known exit code decides it. Concretely,
enforced by `tools/bench-tasks.mjs` on every `npm run check` (via `npm test`'s `tools/*.test.mjs` glob):

- every criterion is one real `seaworthy verify` invocation as an argv array — no shell, no
  pipelines, no metacharacters;
- only flags that exist in the built CLI's own option groups (`packages/verify/src/cli/options/`)
  may appear, limited to `--fail-on`, `--base`, and `--baseline`, and the gate must be explicit —
  a criterion always states its own `--fail-on` level;
- `expect_exit` is one of the CLI's documented exit codes: 0 clean at the level, 1 findings at or
  above it, 2 usage error, 4 a crash (`packages/verify/src/cli/types.ts`);
- each task's criteria must fail on an untouched copy of its `start` fixture (the task is real
  work, not a tautology) and pass on its `reference` site (`fixtures/clean/minimal/site` unless
  the task says otherwise) — both runs happen live, offline, in the tests;
- nothing reaches the network or launches a browser: `--network`, `--rendered`, `--watch`,
  `--changed`, cache- and history-dependent flags are rejected by the validator, so the suite
  scores identically on every machine.

No criterion asks a human to judge anything. If a claim about a task's result cannot be decided by
one of these exit codes, it does not belong in `tasks.json`.

## The workspace contract (for the runner)

Each task runs in its own workspace directory:

1. copy `task.start` to `<workspace>/site/` — `site` is one of the CLI's default built folders
   (`packages/verify/src/folders.ts`), which is why criteria can name it;
2. copy every `task.seeds[]` entry `from` a repo path to `<workspace>/<file>`;
3. hand the agent `task.prompt` and let it edit `<workspace>` (this benchmark has no generator:
   the built output is its own source);
4. score: run each criterion from `<workspace>` as
   `node packages/verify/dist/src/cli.js <criterion.argv…>`; a task is solved when every run's
   exit code equals its `expect_exit`.

The suite is exactly 10 tasks — the validator fails any other count. `proves` names the check IDs
whose findings carry each gate; it is documentation of what the exit code decides, not a second
assertion (the exit code is the whole verdict).

## Limits, honestly

- An exit code proves the state of the site, not the path the agent took. A task therefore starts
  from a seeded finding and gates on its removal; what the prompt additionally asks for (write
  real alt text, don't delete features) is inside the task's `prompt` and is what #102 measures
  beyond the pass/fail verdict.
- `planning/bench/seeds/empty-baseline.json` is stamped with the baseline `spec` version
  (`packages/verify/src/baseline.ts`). If the report spec version ever bumps, the live validation
  fails and the seed must be re-recorded — that is deliberate: a silently unusable seed is worse.
- Start sites are ordinary `fixtures/` sites; nothing in this suite depends on findings a check
  cannot reproduce offline.

## Validating

```bash
npm run build          # the validator reads real flags and check IDs from packages/verify/dist
node tools/bench-tasks.mjs          # full validation, including the live offline runs
node tools/bench-tasks.mjs --quick  # static rules only
```

Both are inside `npm run check`; the standalone command exists for whoever edits `tasks.json`.
