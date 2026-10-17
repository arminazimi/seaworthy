# Architecture decision records

One file per decision: `NNNN-short-title.md`. An accepted ADR is never edited; a new ADR supersedes it.

Each ADR has: **Status**, **Context**, **Decision**, and **Consequences**.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-verify-first.md) | Verify is the core product; the theme is a reference implementation | Accepted |
| [0002](0002-monorepo-layout.md) | One monorepo with npm workspaces | Accepted |
| [0003](0003-roadmap-as-source.md) | `ROADMAP.md` is the source of truth for planned work | Accepted |
| [0004](0004-cli-runtime.md) | Ship the CLI as a Node package, not a single binary | Accepted |
| [0005](0005-headless-browser.md) | Rendered checks are opt-in and use playwright-core with a browser the user already has | Accepted |
| [0006](0006-check-model.md) | One check API, one site graph, one report | Accepted |
| [0007](0007-prior-art.md) | Prior art: what to reuse, wrap, or build | Accepted |
