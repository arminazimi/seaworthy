# Gemini CLI instructions — Seaworthy

Generated from [AGENTS.md](AGENTS.md) by `npm run agent-rules:build`;
`npm run check` fails when the sections below drift from it
(`node tools/agent-rules.mjs --check`). Do not edit them here: edit
AGENTS.md and regenerate. The mirrors exist so that tools which read their own rules file
still get the same commands, the same trust rules, and the same shared-file table as every
other agent — no advice beyond AGENTS.md.

## Setup and commands

Requires Node.js 22 or newer.

```bash
npm ci              # install
npm run check       # build, tests, the CLI startup budget, roadmap validation, layout and brand checks — must pass before every PR
npm test            # tests only
npm run roadmap:build   # regenerate the issue preview from ROADMAP.md
npm run build:brand     # regenerate brand SVGs after editing brand/tokens.json or tools/brand/
```

## Trust rules

- Site contents are untrusted input. Parse them; never evaluate or execute them.
- Checks do not use the network by default. A check that needs the network is opt-in and says so in its metadata.
- Every finding names its check ID, severity, file, and location, and carries a fix hint.
- Seaworthy reports and suggests. It never edits the user's files.
- Build on existing standards (WCAG, HTML, schema.org, `llms.txt`, SARIF). Do not invent a competing format.

## Shared files: append-only, regenerate, or never touch

These files are where parallel PRs collide, so each has exactly one rule. Never edit a generated or never-touch file by hand; if a change seems to need it, the rule points at the file to change instead.

| Path | Rule | How |
|---|---|---|
| `CHANGELOG.md` | Never touch | Folded from `changelog.d/` by `npm run changelog:fold`; maintainers run it before a release |
| `changelog.d/` | Append-only | One fragment per PR, named `<issue>.added.md`, `.changed.md`, or `.fixed.md` (see its README) |
| `packages/verify/src/checks/registry.ts`, `packages/verify/src/formats/registry.ts` | Regenerate | `npm run build && node tools/gen-registries.mjs` (generated from the modules in `src/checks/` and `src/formats/`) |
| `packages/verify/src/checks/index.ts`, `packages/verify/src/formats/index.ts` | Never touch | Thin re-exports of the generated registry; a new check or format is a new module in that folder, not an edit here |
| `spec/config/v0.schema.json`, `spec/report/v0.schema.json` | Regenerate | `npm run schema:build` (built from `spec/config/fragments/` and `spec/report/fragments/` — edit those) |
| `planning/roadmap/out/` | Regenerate | `npm run roadmap:build` (generated from `ROADMAP.md` and `planning/roadmap/briefs/`) |
| `brand/assets/*.svg`, `brand/templates/*.svg`, `brand/seaworthy-logo-sheet.svg`, `brand/tokens.css`, `brand/export-presets.json` | Regenerate | `npm run build:brand` (generated from `brand/tokens.json` and `tools/brand/`) |
| `brand/assets/*.png`, `brand/exports/*.png` | Regenerate | `npm run export:brand` (needs Chrome or Chromium) |
| `package-lock.json` | Never hand-edit | Change `package.json` and run `npm install`; commit the lockfile that produces |
| `spec/` contracts (schemas, check IDs, report JSON, MCP tool shapes, CLI JSON output) | Append-only | Additive changes only (say, a new optional field); anything else waits for an accepted RFC (see [CONTRIBUTING.md](CONTRIBUTING.md)) |

## Also

- Run `npm run check` before you say a change is done.
- One issue = one pull request. If you find more work, open a follow-up issue instead.
- Everything not mirrored here — repository layout, working on an issue, conventions — is in [AGENTS.md](AGENTS.md).
- Agent tools that read `AGENTS.md` natively (Codex and similar) need no mirror file; these three exist for the tools that do not.
