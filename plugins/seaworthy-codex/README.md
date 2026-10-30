# Seaworthy Codex bundle

The [Codex](https://github.com/openai/codex) shape of the Seaworthy agent bundle: the same MCP server the Claude Code plugin (issue #87) registers, wired into Codex with a config snippet you paste, plus the honest state of the Skills.

Codex has **no plugin marketplace**. It reads MCP servers from its own TOML config (`~/.codex/config.toml`, `[mcp_servers.<name>]` with `command` and `args`) and takes instructions and skill files from the filesystem. So this directory is not an installable package: it is a documented bundle — [`codex-config.toml`](codex-config.toml) for the server, [`bundle.json`](bundle.json) as the machine-readable record of what the bundle exposes, and this README for the steps. Nothing here pretends to a format Codex does not have.

## What the server exposes today

Exactly the six tools `packages/mcp/src/server.ts` registers: `list_checks`, `verify_site`, `verify_changed`, `diff_reports` (compares two stored runs), `fix_preview` (every suggested edit as one unified diff, writing nothing), and `explain_finding` (the finding explainer). `site` and `base` follow the CLI's folder order `dist, build, out, public, _site, site`. `get_config_schema` and `create_baseline` are planned in `packages/mcp/src/planned.ts`, are not implemented, and are advertised nowhere in this bundle.

## Installing (pre-alpha: no npm package, no git tag)

`@seaworthy/*` is not published, there is no release tag, and the server is TypeScript built to `dist/` (not committed). Every path below is runnable today.

**1. Get a built checkout** (this is the only end-to-end path today, because the MCP server needs a build):

```bash
git clone https://github.com/arminazimi/seaworthy && cd seaworthy
npm ci && npm run build
```

**2. Point Codex at the server.** Open `~/.codex/config.toml` and paste in the section from [`codex-config.toml`](codex-config.toml), replacing `<checkout>` with the absolute path of the checkout from step 1:

```toml
[mcp_servers.seaworthy]
command = "node"
args = ["/absolute/path/to/seaworthy/plugins/seaworthy/bin/seaworthy-mcp.mjs"]
```

The launcher is the one the Claude Code plugin already ships (`plugins/seaworthy/bin/seaworthy-mcp.mjs`, host-agnostic: it locates a built `packages/mcp/dist/src/main.js` or `$SEAWORTHY_MCP_SERVER`, spawns it with inherited stdio, and never writes to stdout itself). This bundle deliberately does **not** copy it — two copies of the same discovery logic drift, and the launcher has no Claude-specific code in it.

**3. Restart Codex.** The `seaworthy` server then appears in the tool list with the three tools above.

### Using it from your own project instead of a checkout

Install Seaworthy from the git reference — **after** your own `npm ci`, since a git install needs the workspace build step — or put it in `devDependencies`:

```bash
# the commit this bundle was written against; substitute the commit you actually use
npm install --no-save github:arminazimi/seaworthy#081a482feadd5ce71d2cbba0b1f79c9045cd4403
```

```json
{ "devDependencies": { "@seaworthy/verify": "github:arminazimi/seaworthy#081a482feadd5ce71d2cbba0b1f79c9045cd4403" } }
```

Neither package name exists on the registry today, so there is no registry install to run here and no version tag to point at: both are git references to a commit, resolved after your own `npm ci`. Once `@seaworthy/mcp` is published (a Phase 4 maintainer step), a published launcher command becomes the honest snippet and this README gets that follow-up.

## Making the Skills available

Two Skills exist on disk: `skills/seaworthy-verify/SKILL.md` and `skills/seaworthy-adopt/SKILL.md`, and `bundle.json` names exactly those two. `tools/codex-plugin.test.mjs` pins that the list neither leads nor lags `skills/`, so a Skill added here without a file, or a file the bundle forgets, fails the gate.

What Codex can do with them, stated only as far as the mechanism is documented:

- **Point `AGENTS.md` at them.** Codex reads `AGENTS.md`. Reference `skills/seaworthy-verify/SKILL.md` and `skills/seaworthy-adopt/SKILL.md` by path in your project's `AGENTS.md` inside the checkout. We are not asserting a Codex skills directory we cannot verify from public, documented behaviour.
- **Use the CLI directly.** `node packages/verify/dist/src/cli.js verify <site-folder>` (or the `seaworthy` bin) with `--format json` and `--fail-on` works in any Codex session, and the exit codes are stable: `0` clean, `1` findings at or above `--fail-on`, `2` usage error, `4` engine crash.
- **The MCP server already covers most of what a skill tells the agent to do** — `list_checks` returns check metadata, `verify_site` and `verify_changed` return the versioned report JSON with a fix hint per finding, `fix_preview` returns every suggested edit as one unified diff without writing anything.

## What this bundle does not do

- It is not in `.claude-plugin/marketplace.json`, and it adds no marketplace entry: that manifest belongs to Claude Code, and Codex does not read it.
- It writes nothing to your machine. `codex-config.toml` is a snippet **you** paste into `~/.codex/config.toml`; no script here touches your home directory.
- It ships no launcher of its own and no copy of the server.
- It copies no Skill files: the Skills stay in `skills/`, and this bundle only names the ones that exist there. It advertises no planned-but-unbuilt tool.
- It defines no Codex-specific fields: only `command` / `args` under `[mcp_servers.seaworthy]`, which is the documented shape.

| Path | Owns |
|---|---|
| [`README.md`](README.md) | The steps, and the honest limits of a pre-alpha bundle. |
| [`codex-config.toml`](codex-config.toml) | The config snippet you paste into `~/.codex/config.toml`. |
| [`bundle.json`](bundle.json) | Machine-readable record: server name, command, args, launcher path, tools, skills, install facts. |

Invariant checks: [`tools/codex-plugin.test.mjs`](../../tools/codex-plugin.test.mjs).
