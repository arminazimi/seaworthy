# The verify-and-fix loop

The shortest path from "I changed the site" to "I know what is broken and how to fix it." This page is written for agents and for the people wiring them up: every command pastes as-is, and every number on it was measured on a real machine, not guessed.

Seaworthy never edits your files ([AGENTS.md](../AGENTS.md) says it reports and suggests; applying a fix is your move), so the loop is: **build → verify → read findings → edit the source → rebuild → verify again**, with a gate at the end.

## The loop, step by step

### 1. Build

Seaworthy reads the built output, never the source. Run your generator, then verify its folder:

```bash
npm run build                                # or: astro build, hugo, jekyll build, …
npx seaworthy verify dist --format llm       # use the folder your build writes to
```

With no folder it picks the first of `dist`, `build`, `out`, `public`, `_site`, `site` that exists.

### 2. Verify once and read the findings in `llm` format

`--format llm` is the format to read with an LLM in the loop: one line per finding, the fix first, then the check ID, severity, location, and message, grouped by file. On the [canonical fixture](../fixtures/broken/canonical/site) the same run prints 19 KB as `llm` against 131 KB as `json` — a seventh of the context for the same information ([formats](#the-four-ways-to-read-a-finding) below).

```
seaworthy llm fixtures/broken/canonical/site: 69 findings in 10 files (52 warnings, 17 notes), 8 pages, 75 checks
404.html
  Add a not-found page at the site root as 404.html (or 404/index.html). … | quality.not-found-page warning | 404.html | The build has no 404 page, so a broken address shows the host's default error page, and agents reading the site see a soft 404.
copy.html
  Add a one-sentence description. Search engines and link previews show it. | meta.description warning | copy.html:3:1 | The page has no meta description.
```

Every check that was skipped for a reason is listed at the end (`skipped a11y.axe: rendered-checks-disabled. Run with --rendered …`), so what you did not run is visible.

### 3. Fix in the source, using the exact edits

Locations name the built output. Apply the fix in the file that generates it, rebuild, and re-verify; the `prompt` on every finding says exactly this. Three ways to act on a finding:

- **Read its `prompt`** (`--format json`, or the whole-report `--format prompt`): a ready-to-paste instruction with the exact text to replace.
- **Apply `fix.edits` programmatically** (`--format json`). An edit is exact — `find` occurs once on `line`, replaced by `replace` — and `needsInput: true` means a person or agent must supply real content (an alt text, a description):

```json
{
  "checkId": "meta.description",
  "severity": "warning",
  "message": "The page has no meta description.",
  "location": { "file": "copy.html", "line": 3, "column": 1 },
  "fix": {
    "kind": "edit",
    "summary": "Add a one-sentence description. Search engines and link previews show it.",
    "edits": [
      { "file": "copy.html", "line": 4, "action": "replace", "find": "</head>", "replace": "<meta name=\"description\" content=\"One sentence about this page.\"></head>", "needsInput": true }
    ],
    "appliesTo": "built-output"
  },
  "prompt": "Fix this Seaworthy finding. Check meta.description (warning) at copy.html:3:1. …"
}
```

- **Preview everything at once**: `npx seaworthy fix dist --dry-run` prints one unified diff of every safe edit (paths relative to the site folder, so `git apply` takes it) and lists findings that need a human on stderr.

Each check's own page under [docs/checks/](checks/README.md) explains the rule and the fix in prose.

### 4. Re-verify only what changed: `--changed`

After the edit and rebuild:

```bash
npx seaworthy verify dist --format llm --changed
```

`--changed` compares content hashes with the previous run (kept in `.seaworthy/cache.json`) and reports findings in changed files only. Be honest about what it saves: **every check still runs the same full pass** — measured identically at ~0.2 s on a 203-page site either way — what shrinks is the output, from a report capped at 1,000 findings to the 8 in the one edited file. For an agent the output *is* the cost, so this is still the right flag. The first `--changed` run has no cache and counts everything as changed. If your build output is committed to git, `--changed-since <ref>` filters by `git diff` instead of hashes (`--changed` and `--changed-since` are mutually exclusive).

A change in one file can break a link *from* another file that did not change. `--changed` narrows the report, not the truth: CI runs the full check.

### 5. While iterating, keep `--watch` open

```bash
npx seaworthy verify dist --watch
```

The first run prints the full report you chose (here `llm`); after that, every change to the build folder — one burst of writes after a 200 ms quiet window — produces a single re-verify and one compact diff against the previous run:

```
seaworthy: 2 new, 1 fixed, 68 unchanged findings
  + warning a11y.landmarks index.html:3:1: The page has no <main> landmark. Screen reader users cannot jump straight to the content, and have to move through the header and navigation first.
  + error links.internal index.html:8:7: Link to /does-not-exist.html points to a page that does not exist in the built site.
  - warning quality.empty-pages index.html:5:1: This page has no <main> and, apart from its navigation, header, and footer, no text at all, so an agent that reads the HTML gets nothing from this page but the site frame. (fixed)
```

Measured edit-to-status latency: **~0.22 s on an 8-page site and ~0.35 s on a 203-page site** — mostly the debounce, and well inside the 2-second-per-rebuild bar the roadmap sets for this epic. Ctrl-C stops it (exit 130). `--watch` replaces `--changed` (it already prints only what changed), so the two do not combine.

### 6. Park the existing debt: `--baseline`

An old site is noisy on day one. Record the current findings once, then run against the baseline so only *new* ones report and fail:

```bash
npx seaworthy verify dist --update-baseline seaworthy-baseline.json   # record everything current, exit 0
npx seaworthy verify dist --baseline seaworthy-baseline.json          # report and fail only on new findings
```

The baseline stores fingerprints with counts, not line numbers, so it survives edits that move a finding; the [configuration page](configuration.md) covers it and per-check suppressions. Measured cost of applying a 69-entry baseline: 0.1–0.3 ms inside the run — too cheap to measure against the wall clock.

### 7. Gate the loop: `--fail-on` and the exit codes

```bash
npx seaworthy verify dist --fail-on warning --format json --out seaworthy-report.json
echo $?   # 0 clean at that level · 1 findings at or above it · 2 usage error · 4 a check crashed
```

`--fail-on` takes `error` (the default), `warning`, `note`, or `none`; the config's `failOn` sets it permanently. The exit code is decided from **all** findings, even ones a `--max-findings` cap hid from the report, so a green run means clean, not truncated. `seaworthy diff before.json after.json` compares two saved JSON reports by fingerprint when you want the delta itself, not just the verdict.

## The measured numbers

All timings on this page were measured on **October 29, 2026** on one machine: macOS 26.6.1 on an Apple M5, Node **v22.23.1**, from a built checkout (`npm run build`) invoking `node packages/verify/dist/src/cli.js verify …`. Fixture sites were copied to a scratch folder first, so the `--changed` cache and run history never wrote inside the repository. Wall time is `/usr/bin/time` from spawn to exit; engine time is the CLI's own [`--timings`](#what--timings-shows) block. Each figure is the representative (best) of at least two back-to-back warm runs; a cold filesystem or a loaded machine is slower — the first run over a freshly generated 203-page site measured 6–8× the settled number. Treat these as orders of magnitude on an idle machine, not constants.

| Run | Site | Wall | Engine total | Where the time went |
|---|---|---|---|---|
| `verify --format llm` | 8 pages, 69 findings (canonical fixture) | 0.06 s | ~13.5 ms | site graph 3.7 ms · checks 8.2 ms · report 0.7 ms |
| `verify --format llm` | 9 pages, 60 findings (social fixture) | 0.06 s | ~16 ms | site 5 ms · checks 10 ms |
| `verify --format llm` | 203 pages (generated) | 0.21 s | ~165 ms | site 25 ms · checks ~137 ms · report 2 ms |
| `verify --changed` (first run: bootstraps the cache) | 203 pages | 0.21 s | ~167 ms | + hash stage 3.5 ms |
| `verify --changed` (one file edited since last run) | 203 pages | 0.21 s | ~165 ms | same compute; output 8 findings, not 1000+ |
| `verify --watch`, edit → status line | 8 pages | ~0.22 s | ~14 ms per cycle | 200 ms debounce dominates |
| `verify --watch`, edit → status line | 203 pages | ~0.35 s | ~150 ms per cycle | debounce + full re-verify |
| `verify --rendered` | 8 pages | 5.0–8.9 s | 5.0–8.8 s | browser launch and page renders |
| `verify --network` | 8 pages, fixture with external links | 0.90 s | ~850 ms | networked checks (`links.external`, `readability.markdown-negotiation`); network-dependent |
| `verify --baseline <69 entries>` | 8 pages | 0.07 s | ~18 ms | baseline stage 0.1–0.3 ms — noise |
| `--version` (process start only) | — | 0.04–0.08 s | — | inside the 150 ms budget of [ADR 0004](adr/0004-cli-runtime.md) |

Read the last row first: **starting the process costs more than the engine spends verifying an 8-page site.** A bare `verify` run pays ~50 ms of Node and module loading before the engine's ~14 ms of work. That is why the loop prefers one `--watch` process over N scripted runs, and why `--changed` matters for big sites.

### What `--timings` shows

`--timings` prints the breakdown to stderr (stderr only — the report stays byte-identical), so you can measure your own site instead of trusting this table:

```
seaworthy: timings
  total 13.6 ms
  stage site 3.8 ms
  stage checks 8.5 ms
  stage suppressions 0.1 ms
  stage baseline 0.0 ms
  stage report 0.6 ms
```

Per-check lines follow. Checks run concurrently, so those lines overlap and the largest ones, not the sum, are the story. Anything under ~0.5 ms here (and every `--max-findings`, `--no-history`, or `--baseline` decision) is too cheap to measure reliably; it is listed as such rather than as noise.

## Which flags cost time and which save it

| Flag | Effect on the clock |
|---|---|
| `--rendered` | By far the most expensive: ~5–9 s even for an 8-page site, because it launches a browser and renders pages. Off by default; keep it off inside the edit loop and run it before you ship. `--browser-path` picks the executable; it costs nothing itself. |
| `--network` | Runs `links.external` and `readability.markdown-negotiation` for real. 0.9 s on the fixture; on a site with many links, expect seconds, and treat the result as network-dependent. Opt-in by design. |
| `--changed` / `--changed-since` | Save **output**, not compute: every check still runs the full pass (hash/git stages add ~4 ms per 200 files), but the report holds only findings in changed files. For an agent, output is the budget. |
| `--watch` | Saves the ~50 ms process start every cycle, and gives you the diff for free. The 200 ms debounce, not the checks, sets the cadence. |
| `--max-findings`, `--no-history`, `--baseline`, `--out` | Unmeasurable on these sites (sub-millisecond stages). `--max-findings` bounds report *size* (context), not time; it never changes the exit code. |
| `--format` | Rendering the report is ~1 ms in every format. Choose by what you do with it, not by speed. |
| `--timings` | Negligible; collect it while measuring anything else on this page. |

Structurally, engine time splits into the site-graph build (parse every page once: ~25 ms for 203 pages) and the checks pass (~137 ms for the same). Both grow roughly linearly with the site, so a 20-page site verifies in well under a tenth of a second and a 2,000-page site in a couple of seconds, offline.

## The four ways to read a finding

Same run, same findings, eight shapes (`pretty` and `html` are for people; `markdown` and `sarif` are for other tools):

| Format | Bytes for the fixture's 69 findings | Made for |
|---|---|---|
| `llm` | 19 KB | An agent reading the findings in a context window: fix first, one line each, grouped by file. The loop default. |
| `prompt` | 22 KB | Pasting one instruction that fixes everything: grouped by file, fewest-findings file first, exact `replace … with …` edits inline. |
| `json` | 131 KB | Programmatic reading: full `fix.edits`, fingerprints, summary, skipped checks and errors. The contract; everything else is a view of it. |
| `ndjson` | 72 KB | Large sites and pipelines: one finding per line as its check finishes, so you can start acting before the run ends. |

A finding's `prompt` field (in `json`, and the same text the pretty report shows under `prompt:`) is self-contained: check ID, severity, location, message, fix, and the reminder to fix the source and rebuild. Reading it needs no other context.

## The copy-paste loop

Everything an agent needs, in order. Run from the project root; adjust the build command and folder:

```bash
# 1 · build, then read the whole picture once
npm run build && npx seaworthy verify dist --format llm

# 2 · after every edit round: rebuild and re-read only changed files
npm run build && npx seaworthy verify dist --format llm --changed

# 3 · or keep one watch open in a spare terminal while you edit
npx seaworthy verify dist --watch

# 4 · adopt an existing site without drowning: park today's findings
npx seaworthy verify dist --update-baseline seaworthy-baseline.json

# 5 · gate: fail on new findings at warning level or above, keep the report
npx seaworthy verify dist --baseline seaworthy-baseline.json \
  --fail-on warning --format json --out seaworthy-report.json && echo CLEAN
```

Exit codes: `0` clean at the `--fail-on` level · `1` findings at or above it · `2` usage error (unknown flag, missing folder) · `4` a check or the engine crashed · `130` Ctrl-C during `--watch`.

## Through the MCP server and CI

The MCP server (`seaworthy-mcp`, package [`@seaworthy/mcp`](../packages/mcp)) registers `list_checks`, `verify_site`, and `verify_changed` today; `verify_changed` covers the `--changed` loop (`since` takes a git ref), and all three return the same report JSON as `--format json`. `explain_finding`, `get_config_schema`, and `create_baseline` are still planned and are not advertised by the server — do not call them.

By default the server speaks JSON-RPC over stdio, which is what an MCP client that starts the process itself should use. For a client that cannot spawn it, `seaworthy-mcp --http` serves the same server over Streamable HTTP on `/mcp`: loopback only unless you also pass `--allow-non-loopback`, on port 3333 unless you pass `--port`, and it verifies only the folder named by `--root` (default the current folder) — a `verify_site` or `verify_changed` call naming a site outside it is refused. Run `seaworthy-mcp --help` for the flags. This is a local developer transport, not a hosted one: it has no authentication, so on a non-loopback bind every host that can reach the port can make it verify folders under `--root` on this machine. `@seaworthy/mcp` is pre-alpha and not published on npm, so install it from this repository (`npm install --no-save github:arminazimi/seaworthy#<commit>` after the site's own `npm ci`) and start it with `npx seaworthy-mcp`.

In CI, use the full run (no `--changed`), `--fail-on` as the threshold, and optionally `--format sarif --out` for the GitHub code-scanning annotations. The composite [GitHub Action](../action.yml) wraps exactly this, with inputs `site`, `threshold`, and `sarif`; anything more (root, baseline, per-check settings) goes in `seaworthy.config.json`, which the Action's CLI reads from the workspace.

## See also

- [Configuration](configuration.md) — config file, baselines, suppressions, run history
- [Check contracts](checks/README.md) — one page per check ID, with before/after fixes
- [agents-playbook](agents-playbook.md) — running many agents on this repository (a different loop)
- [ADR 0004: CLI runtime](adr/0004-cli-runtime.md) — the startup budget these timings sit inside
