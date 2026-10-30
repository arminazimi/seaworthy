# Seaworthy Claude Code plugin

Bundles the Seaworthy MCP server as a [Claude Code plugin](https://code.claude.com/docs/en/plugins). Installing it registers the `seaworthy` MCP server, so any session in a project with a built site can call the server's tools — `list_checks`, `verify_site`, `verify_changed` and the rest — and get the same versioned report JSON the CLI writes, every finding with its check ID, location, and fix hint.

## What the server exposes today

Exactly the six tools `packages/mcp/src/server.ts` registers: `list_checks`, `verify_site`, `verify_changed` (`verify_changed` covers the `--changed` loop; `site` and `base` follow the CLI's folder order `dist, build, out, public, _site, site`), `diff_reports`, `fix_preview`, and `explain_finding`. `get_config_schema` and `create_baseline` are planned in `packages/mcp/src/planned.ts`, are not implemented, and are advertised nowhere in this plugin.

## Installing (pre-alpha: no npm package, no git tag)

The MCP server is TypeScript built to `dist/`, and `dist/` is not committed. So today only the local-marketplace path is runnable end to end:

```bash
git clone https://github.com/arminazimi/seaworthy && cd seaworthy
npm ci && npm run build
claude plugin marketplace add .          # reads .claude-plugin/marketplace.json
claude plugin install seaworthy@seaworthy
```

Adding the marketplace from GitHub (`claude plugin marketplace add arminazimi/seaworthy`) is reproducible from the repository as it stands, but the cloned plugin has no build output; the bundled launcher then exits with a fix hint instead of pretending the server started. Once `@seaworthy/mcp` is published to npm (a Phase 4 maintainer step), the server command can become `npx seaworthy-mcp` and the remote path works without a build.

## What this plugin does not bundle yet

No `SKILL.md` exists in this repository while its issue (#83) is open, so the plugin ships no `skills/` component rather than pointing at paths that do not exist. When the Skills land, they are added under `plugins/seaworthy/skills/<name>/SKILL.md` (the plugin layout Claude Code discovers automatically) in a follow-up.

`node_modules`-free by design: the launcher at [`bin/seaworthy-mcp.mjs`](bin/seaworthy-mcp.mjs) only locates a built `packages/mcp/dist/src/main.js` (or `$SEAWORTHY_MCP_SERVER`) and spawns it with inherited stdio. It never writes to stdout itself. The layout and manifest invariants are pinned by [`tools/claude-plugin.test.mjs`](../../tools/claude-plugin.test.mjs).
