# 0002. One monorepo with npm workspaces

**Status:** Accepted (2026-10-17)

## Context

Seaworthy has several deliverables that share one contract: the verify engine and CLI, an MCP server, a GitHub Action, Agent Skills, specs, fixtures, and a reference theme. Contract changes must land in all of them at once.

## Decision

- One repository, npm workspaces, TypeScript in strict mode, ES modules, Node.js 22 or newer.
- Packages under `packages/` use the `@seaworthy/` scope: `verify` (engine and `seaworthy` CLI), `mcp`, `action`.
- Non-package folders: `skills/`, `theme/`, `fixtures/`, `spec/`, `docs/`, `brand/`, `planning/roadmap/`.
- MCP and Action are thin adapters over the verify API and own no check logic.
- `npm run check` is the single gate for every PR: build, tests, roadmap validation, and layout check.
- Tests use Node's built-in test runner, so the toolchain needs no test framework.

## Consequences

- One PR can change a contract and every consumer together.
- Dev dependencies stay minimal (TypeScript and Node types) until a task needs more.
- The theme lives in the same repo for now. If its release cadence diverges, it can move out later without changing the verify packages.
