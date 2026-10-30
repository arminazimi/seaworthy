# Verify from an agent: MCP, Skill, or CLI?

An agent that has just built a website has three ways to run Seaworthy: the **MCP
server**, the **Agent Skills**, or the **CLI**. All three drive the same engine, run
the same checks, and return the same findings — every finding carries its check ID,
severity, file, and location, and a fix hint (the check set is listed under
[`checks/`](checks/README.md)). What differs is who drives the verify-and-fix loop
and how the agent consumes the report. This page helps you pick; the loop itself —
build, verify, fix at the source, re-verify, gate on the exit code — is specified
once in [agent-loop.md](agent-loop.md) and is **not** restated here.

## At a glance

| Route | Right when | What the agent sees |
| --- | --- | --- |
| [MCP server](#mcp-server) | The agent host speaks MCP and you want tool-shaped access — call a tool, get a report, ask about one finding — without the agent leaving its tool loop | JSON reports and prose answers as tool results |
| [Agent Skills](#agent-skills) | The agent is a coding agent that reads instructions and runs shell commands; you want it to drive the whole loop itself | Skill instructions, and the CLI it drives |
| [CLI](#cli) | CI, scripts, pipelines, or any agent without MCP or skills — everything else | Exit codes, stdout, and saved report files |

They compose, and using more than one is normal: an agent works interactively through
MCP or a skill, and the same site is gated in CI by the CLI with `--format json --out`
and the exit code.

## MCP server

Register the server with your MCP client and call its tools in place of shell
commands. The registered tools, in registration order:

1. `list_checks` — the check metadata (IDs, severities, what each check does).
2. `verify_site` — run the checks against a built folder; returns the report.
3. `verify_changed` — re-run and report only what changed, the tool-shaped form of
   the incremental re-verify step.
4. `diff_reports` — compare two saved reports by fingerprint (new / fixed / unchanged).
5. `fix_preview` — the unified diff of every safe suggested edit; Seaworthy never
   applies it, the agent decides.
6. `explain_finding` — turn one finding into prose an agent can act on.

Three prompts are registered too: `fix_everything`, `adopt_existing_site`, and
`make_agent_ready` — copy-pasteable instructions the server renders for a site
folder. Two further tools, `get_config_schema` and `create_baseline`, are planned
and stay **unregistered** until they ship, so a client never sees them advertised.

Run it over stdio from a built checkout (see [Install](#install-pre-alpha-honesty)):

```json
{
  "mcpServers": {
    "seaworthy": {
      "command": "node",
      "args": ["/path/to/seaworthy/packages/mcp/dist/src/main.js"]
    }
  }
}
```

The package's bin is `seaworthy-mcp` (it speaks JSON-RPC on stdio and nothing else
on stdout). Choose MCP when the agent's host supports it and you want the loop to
run as tool calls — no command strings, no parsing stdout, and `explain_finding` /
`fix_preview` available as first-class results.

## Agent Skills

The repo ships two skills under [`skills/`](../skills/README.md); each is the
executable distillation of a doc, and every command inside is what the CLI accepts
today.

- [`seaworthy-verify`](../skills/seaworthy-verify/SKILL.md) — the verify-and-fix
  loop end to end: `verify --format llm` for the whole picture, fix at the source,
  `--changed` for re-verify, `--watch` while iterating, then gate with `--fail-on`
  and the exit codes. Use it when the agent should *do* the loop, not just run one
  command.
- [`seaworthy-adopt`](../skills/seaworthy-adopt/SKILL.md) — adopting an existing
  site in four moves: first honest look (`--fail-on none`), committed baseline
  (`--update-baseline`), CI gate, badge. Use it when the site already has findings
  and a day-one gate would start the project with red CI.

Choose a skill when your agent reads `SKILL.md` files and runs real commands: the
skill gives it the loop, the flags, and the rules of the road; the CLI does the
work. If the CLI's `--help` rejects a flag the skill used, the help is newer — trust
the help.

## CLI

`seaworthy verify [dir]` with no folder picks the first existing of `dist`, `build`,
`out`, `public`, `_site`, `site`. Flags you will actually use (full list in
`--help`): `--format json|ndjson|llm|prompt`, `--out <file>`, `--fail-on
error|warning|note|none`, `--changed`, `--changed-since <git-ref>`, `--watch`,
`--baseline <file>` / `--update-baseline <file>`, `--new-only`, `--max-findings`,
`--config <file>`, `--timings`, and the opt-in `--rendered` (with `--browser-path`)
and `--network` — by default a run is fully offline and launches nothing.

Beyond `verify`: `seaworthy init [dir]` writes a config, a CI workflow, and an empty
baseline in one step; `seaworthy fix [dir] --dry-run` prints one unified diff of
every suggested edit (dry-run is the only mode); `seaworthy diff before.json
after.json`; `seaworthy history`; `seaworthy config check [file]`.

Exit codes: `0` clean at or above `--fail-on` (default `error`) · `1` findings at or
above it · `2` usage error · `4` a check or the engine crashed · `130` Ctrl-C during
`--watch` (which replaces `--changed`; do not combine them). The exit code is
decided from all findings even when `--max-findings` caps the report.

```bash
npm run build                                   # build the site first — verify reads built output
npx seaworthy verify dist --format llm          # the whole picture, agent-readable
npx seaworthy verify dist --fail-on warning \
  --format json --out seaworthy-report.json     # the gate + the artifact
```

Choose the CLI when there is no MCP client and no skill loader: CI, shell scripts,
CI-debugging agents, or any pipeline that needs a deterministic JSON artifact and an
exit code. `--format json` is the versioned contract; `llm` and `prompt` are the
agent-facing readings.

## Install (pre-alpha honesty)

Seaworthy is pre-alpha: `@seaworthy/*` is not on npm and no release tag exists.
Never write `npm i -D seaworthy` or a `@v1` pin. Two forms run today (Node.js 22+):

- **Built checkout:**
  ```bash
  git clone https://github.com/arminazimi/seaworthy && cd seaworthy
  npm ci && npm run build
  npm link -w @seaworthy/verify    # puts `seaworthy` on PATH; or invoke
                                   # node packages/verify/dist/src/cli.js directly
  ```
- **Pinned into the site repo**, installed *after* the site's own `npm ci` (a later
  `npm ci` wipes it):
  ```bash
  npm install --no-save github:arminazimi/seaworthy#<full-commit-SHA>
  ```
  Pin a full commit SHA you trust so the tools cannot drift under you.

`npx seaworthy …` in command samples above means whichever launcher you set up; once
the npm release lands it works as written.

## See also

- [agent-loop.md](agent-loop.md) — the verify-and-fix loop, measured timings, every
  flag and what it costs. The reference this playbook points at instead of repeating.
- [skills/seaworthy-verify](../skills/seaworthy-verify/SKILL.md) ·
  [skills/seaworthy-adopt](../skills/seaworthy-adopt/SKILL.md)
- [adoption-playbook.md](adoption-playbook.md) — the human-facing adoption story.
- [../packages/mcp](../packages/mcp/README.md) — the server's own README.
