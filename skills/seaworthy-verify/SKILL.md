---
name: seaworthy-verify
description: Runs the Seaworthy verify-and-fix loop on a built static site — verify the built output, read the findings by check ID and location, fix the source, re-verify, and stop at the exit-code gate. Use when an agent has just built or changed a website and needs to know what is broken and how to fix it, when the user asks to "verify the site", "run seaworthy", or check a site for broken links, accessibility, or agent-readability problems, or before the agent says a site is done. Do not use it to adopt Seaworthy into CI or to park existing debt; that is a separate skill.
---

# Seaworthy: the verify-and-fix loop

Seaworthy verifies **built output**, never source: build first, then point it at the
output folder. It reports and suggests; it never edits files. Applying a fix is your move.

The full reference is [`docs/agent-loop.md`](../../docs/agent-loop.md) — measured timings,
every flag, and what each one costs. This skill is the executable distillation of it:
every command and flag below is what the CLI accepts today.

## Setup (pre-alpha: no npm package yet)

Requires Node.js 22+. `seaworthy` is not published on npm — do not run `npm i seaworthy`.
Pick one launcher:

- **From a built checkout** (works today):
  ```bash
  git clone https://github.com/arminazimi/seaworthy && cd seaworthy
  npm ci && npm run build
  npm link -w @seaworthy/verify     # puts `seaworthy` on PATH; or invoke
                                    # node packages/verify/dist/src/cli.js directly
  ```
- **Pinned into the site's own repo** as a devDependency, installed *after* the site's
  `npm ci` (a later `npm ci` wipes it):
  `npm install --save-dev github:arminazimi/seaworthy#<commit>`

Once the npm release lands, the same commands run as `npx seaworthy …`. Below, `seaworthy`
means whichever launcher you set up. If a flag is rejected, the CLI's `--help` is newer
than this skill — trust `--help`.

## The loop

1. **Build, then get the whole picture once:**
   ```bash
   npm run build   # or astro build, hugo, jekyll build, …
   seaworthy verify dist --format llm
   ```
   With no folder it picks the first of `dist`, `build`, `out`, `public`, `_site`, `site`
   that exists. `--format llm` is the reading format for an agent in a context window:
   one line per finding, fix hint first, then `checkId severity | file:line:col | message`,
   grouped by file. Checks skipped for a reason (browser, network) are listed at the end.

2. **Fix the source, not the built file.** Locations name built output; edit the file that
   generates it, rebuild. Every finding carries a stable check ID — the rule and the fix
   in prose live at `docs/checks/<checkId>.md` (e.g. `meta.description`, `links.internal`).

3. **Re-verify only what changed:**
   ```bash
   npm run build && seaworthy verify dist --format llm --changed
   ```
   `--changed` reports findings in files whose content hash changed since the last run
   (cache in `.seaworthy/cache.json`; the first run counts everything as changed). It
   shrinks the *output*, not the compute; a link broken *from* an unchanged file is still
   real, so CI runs the full check, never `--changed`. If your build output is committed,
   `--changed-since <git-ref>` filters by `git diff` instead (the two are mutually exclusive).

4. **While iterating, keep one watch open instead of re-spawning:**
   ```bash
   seaworthy verify dist --watch
   ```
   The first run prints the full report; each later change to the build folder prints only
   `+ new` / `- fixed` findings. It replaces `--changed` (do not combine them); Ctrl-C stops.

5. **Gate and stop.** Save the machine-readable report and let the exit code decide:
   ```bash
   seaworthy verify dist --fail-on warning --format json --out seaworthy-report.json
   ```
   `--fail-on` takes `error` (the default), `warning`, `note`, or `none`. Exit codes:
   `0` clean at that level · `1` findings at or above it · `2` usage error ·
   `4` a check or the engine crashed · `130` Ctrl-C during `--watch`. A green run means
   clean, not truncated: even when `--max-findings` caps the report, the exit code is
   decided from all findings.

## Reading and acting on findings programmatically

- `--format json` is the contract: each finding has `checkId`, `severity`, `message`,
  `location` (`file`, `line`, `column`), `fix.summary`, `fix.edits` (exact `find`/`replace`
  on a `line`; `needsInput: true` means a human must supply real content, e.g. alt text),
  and a self-contained `prompt`. `--out <file>` writes the report and prints a one-line summary.
- `--format prompt` renders one copy-pasteable instruction that fixes every finding,
  grouped by file, fewest-findings file first.
- `--format ndjson` streams one JSON finding per line as each check finishes — for large
  sites and pipelines; line order follows check completion.
- To preview every safe edit at once: `seaworthy fix <dir> --dry-run` prints one unified
  diff (paths relative to the site folder, so `git apply` from that folder takes it) and
  lists findings that need a human on stderr. `--dry-run` is the only mode; passing
  anything else to `fix` is a usage error by design.

## Keeping the noise down

- `--update-baseline <file>` records all current findings and exits 0; `--baseline <file>`
  then reports and fails only on findings the baseline does not accept. The baseline
  stores fingerprints with counts, so it survives edits that move a finding. The two flags
  are mutually exclusive, and `--update-baseline` cannot combine with `--changed` or `--watch`.
- `--new-only` reports only findings the *previous run* did not have, reading
  `.seaworthy/history`; it cannot combine with `--no-history`, and without a previous
  run's keys it reports everything and says so.
- `seaworthy diff before.json after.json` compares two saved `--format json` reports by
  fingerprint (new / fixed / unchanged), so the same problem moved to a new line stays "unchanged".

## Opt-in checks

By default a run is fully offline and launches nothing. `--rendered` runs the checks that
need a browser (`--browser-path <exe>` picks it); `--network` runs the checks that make
real requests. Both are slow relative to the rest of the loop — keep them off inside the
edit cycle and run them before shipping.

## Rules of the road

- Fix the generator's source (templates, front matter, config), never the built HTML, and
  rebuild before re-verifying — otherwise the next run "fixes" nothing.
- Prefer the smallest safe change per finding; each check page under
  [`docs/checks/`](../../docs/checks/README.md) explains what "fixed" means for it.
- Seaworthy never writes to your site. Do not make it do so by other names: apply an edit
  only after reading the finding it comes from.
