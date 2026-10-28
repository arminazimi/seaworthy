# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Cursor, Copilot, Kilo Code, and others) and for people working the same way. Read this before changing the repository.

## What Seaworthy is

Seaworthy verifies websites for agents. One command checks any built static site, from any framework and on any host, and returns a versioned, machine-readable report. Every finding has a stable check ID, a location, and a fix hint an agent can apply. It ships as a CLI, an MCP server, a GitHub Action, and Agent Skills. The reference theme is a separate project that uses Seaworthy to verify itself (ADR 0009).

**Status: pre-alpha.** The repository skeleton exists; the verify engine does not yet. See [ROADMAP.md](ROADMAP.md).

## Setup and commands

Requires Node.js 22 or newer.

```bash
npm ci              # install
npm run check       # build, tests, the CLI startup budget, roadmap validation, layout and brand checks — must pass before every PR
npm test            # tests only
npm run roadmap:build   # regenerate the issue preview from ROADMAP.md
npm run build:brand     # regenerate brand SVGs after editing brand/tokens.json or tools/brand/
```

## Repository layout

| Path | Owns | Must not |
|---|---|---|
| `packages/verify` | The engine, checks, report, and the `seaworthy` CLI | Depend on any site generator's internals; it reads built output only |
| `packages/mcp` | The MCP server: a thin adapter over the verify API | Own check logic |
| `packages/action` | The GitHub Action: a thin adapter over the verify API | Own check logic |
| `skills/` | Agent Skills | Contain logic the CLI does not also expose |
| `fixtures/` | Built sites with ground-truth findings | Contain anything a check cannot reproduce offline |
| `spec/` | Versioned contracts | Change without an RFC once frozen |
| `docs/adr/` | Architecture decisions | Be edited after acceptance; supersede instead |
| `planning/roadmap/` | Tooling that turns `ROADMAP.md` into issues | Be the source of truth; `ROADMAP.md` is |

## Trust rules

- Site contents are untrusted input. Parse them; never evaluate or execute them.
- Checks do not use the network by default. A check that needs the network is opt-in and says so in its metadata.
- Every finding names its check ID, severity, file, and location, and carries a fix hint.
- Seaworthy reports and suggests. It never edits the user's files.
- Build on existing standards (WCAG, HTML, schema.org, `llms.txt`, SARIF). Do not invent a competing format.

## Working on an issue

1. Pick an open issue whose dependencies are closed. Its `lane:` label says who it suits; `size:` says how big it is.
2. Follow the issue's **Agent brief** if it has one: touch only the listed files, follow the steps, respect the "Do not" list. If it has no brief yet, comment with your plan before writing code.
3. **One issue = one pull request.** If you find more work, open a follow-up issue instead of growing the PR.
4. Add or update tests for observable behavior. Keep JSON output deterministic and identical across platforms.
5. Run `npm run check` and make sure it passes.
6. Open the PR with `Closes #<issue>` and list the commands you ran.

## Conventions

- Commit messages use Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- TypeScript, strict mode, ES modules. Match the surrounding code: naming, comment density, error style.
- Do not reformat unrelated files. Do not add dependencies without stating the reason in the PR.
- Versioned contracts (`spec/`, report JSON, check IDs, MCP tool shapes, CLI JSON output) change only additively unless an accepted RFC says otherwise.

## Generated files: do not edit by hand

| Path | Regenerate with |
|---|---|
| `planning/roadmap/out/` | `npm run roadmap:build` (source: `ROADMAP.md` and `planning/roadmap/briefs/`) |
| `brand/assets/*.svg`, `brand/templates/*.svg`, `brand/seaworthy-logo-sheet.svg`, `brand/tokens.css`, `brand/export-presets.json` | `npm run build:brand` (source: `brand/tokens.json` and `tools/brand/`) |
| `brand/assets/*.png`, `brand/exports/*.png` | `npm run export:brand` (needs Chrome or Chromium) |

## More

- [ROADMAP.md](ROADMAP.md): phases, epics, and tasks
- [CONTRIBUTING.md](CONTRIBUTING.md): lanes, sizes, and how to claim work
- [docs/adr/](docs/adr/): decisions and why
- [SECURITY.md](SECURITY.md): reporting vulnerabilities
