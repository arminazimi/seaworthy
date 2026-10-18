# Architecture decision records

One file per decision: `NNNN-short-title.md`. An accepted ADR is never edited; a new ADR supersedes it.

Each ADR has: **Status**, **Context**, **Decision**, and **Consequences**.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-verify-first.md) | Verify is the core product; the theme is a reference implementation | Accepted (theme part superseded by 0009) |
| [0002](0002-monorepo-layout.md) | One monorepo with npm workspaces | Accepted |
| [0003](0003-roadmap-as-source.md) | `ROADMAP.md` is the source of truth for planned work | Accepted |
| [0004](0004-cli-runtime.md) | Ship the CLI as a Node package, not a single binary | Accepted |
| [0005](0005-headless-browser.md) | Rendered checks are opt-in and use playwright-core with a browser the user already has | Accepted |
| [0006](0006-check-model.md) | One check API, one site graph, one report | Accepted |
| [0007](0007-prior-art.md) | Prior art: what to reuse, wrap, or build | Accepted |
| [0008](0008-sarif-locations.md) | SARIF locations are repository-relative | Accepted |
| [0009](0009-theme-split-and-position.md) | The theme becomes its own project; Seaworthy competes on pre-deploy verification and CI-grade contracts | Accepted |
| [0010](0010-markdown-links.md) | Repository Markdown is checked by an opt-in package that reuses the core finding model | Accepted |
| [0011](0011-live-site-crawling.md) | Live sites are crawled into a folder snapshot that the existing pipeline verifies | Accepted |
