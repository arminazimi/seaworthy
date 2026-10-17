# Consumer: the reference theme

The reference theme is an editorial, RTL-ready site template that moved out of this repository into its own project ([ADR 0009](../adr/0009-theme-split-and-position.md)). It builds sites; Seaworthy verifies them. **The dependency points one way: the theme depends on Seaworthy, never the reverse.** Nothing in Seaworthy may import from, wait on, or special-case the theme; everything it needs is a public, versioned Seaworthy contract that any theme or generator can use.

## What the theme needs from Seaworthy

| Theme feature | Seaworthy deliverable | Seaworthy phase | Issue |
| --- | --- | --- | --- |
| CI gate: no pull request merges unless every check passes | `seaworthy verify` CLI, then the GitHub Action | Phase 1 (CLI), Phase 2 (Action) | [#88](https://github.com/arminazimi/seaworthy/issues/88) |
| Install without git | npm release | Phase 4 | [#122](https://github.com/arminazimi/seaworthy/issues/122) |
| "Seaworthy" badge in every site's README | Badge endpoint | Phase 2 | [#90](https://github.com/arminazimi/seaworthy/issues/90) |
| Agent-readable output: `llms.txt`, Markdown twin per page, JSON-LD | Agent-readability spec and its checks | Phase 1 | [#69](https://github.com/arminazimi/seaworthy/issues/69), [#70](https://github.com/arminazimi/seaworthy/issues/70), [#71](https://github.com/arminazimi/seaworthy/issues/71), [#72](https://github.com/arminazimi/seaworthy/issues/72) |
| Agent Skills index in every site | `readability.agent-skills-index` | Phase 1 | [#220](https://github.com/arminazimi/seaworthy/issues/220) |
| **Source maps**: findings point at the Markdown file and line, not the built HTML | `spec.source-map` (the contract), `int.source-map` (Seaworthy reads it) | Phase 3 | [#197](https://github.com/arminazimi/seaworthy/issues/197) and a new issue for `spec.source-map` |
| **"Edit with your agent"** button with a source-aware prompt | Prompt format from `agent.fix-prompts`, locations from the source map | Phase 2, Phase 3 | [#264](https://github.com/arminazimi/seaworthy/issues/264) |
| Theme MCP server's `verify` tool | Seaworthy MCP `verify_site` | Phase 2 | [#77](https://github.com/arminazimi/seaworthy/issues/77) |
| **WebMCP** tools in every site (experimental) | `readability.webmcp`, a rendered check | Phase 5 | new issue |
| Starters verified in both directions | `int.theme-fixture`: theme starters run as clean fixtures here | Phase 5 | new issue |
| Co-launch: "build with the theme, verify with Seaworthy" | `launch2.theme-consumer` | Phase 5 | [#354](https://github.com/arminazimi/seaworthy/issues/354) |

## Timing notes

- **Before the npm release (Phase 4)**, the theme installs Seaworthy from git, pinned to a commit: `npm install --save-dev github:arminazimi/seaworthy#<commit>`. Move to the npm package when it is published.
- **Before the Action (Phase 2)**, the theme's CI runs the CLI directly: `npx seaworthy verify _site --format sarif`.
- **Source maps** land in Seaworthy in Phase 3 (late December to mid-January); the theme's source-map output is in its Phase 2 (mid-December to early January), so the theme writes the format first and Seaworthy starts reading it right after. The contract (`spec.source-map`) must be agreed before either side ships.

## Rules for changes

- A Seaworthy change that would break the theme is a contract change: it goes through the RFC process like any other, and the theme is one of the consumers that must be told.
- The theme reports Seaworthy bugs as issues here, with a minimal reproduction, like any user.
- If the theme needs something new from Seaworthy, it becomes a task in `ROADMAP.md` here, designed for every consumer, not just the theme.
