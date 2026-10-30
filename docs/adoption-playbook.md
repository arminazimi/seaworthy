# Playbook: adopting verify in a large existing site

A thousand-page site has years of accumulated problems. The honest first run of `seaworthy verify` on it is a wall of findings nobody can act on, and a CI gate that fails on day one gets deleted by Friday. This playbook turns it on without breaking the team: look, baseline, gate only on new findings, then tighten one family at a time. Every command, flag, config key and check ID here exists on `main` today; anything that does not is said so in one line.

## What Seaworthy sees, and when

Seaworthy reads **built output only**: the HTML folder your generator wrote, never its source, config internals, or templates ([AGENTS.md](../AGENTS.md)). For a large site that makes the build the bottleneck, not the checks: this is a post-build story, and every step below runs after your existing build step. Seaworthy never runs the generator and never edits your files ([trust rules](../AGENTS.md#trust-rules)).

One run builds a site graph first: every HTML file is read and parsed into memory before any check runs ([`src/site.ts`](../packages/verify/src/site.ts)), then all enabled checks run concurrently over that shared read-only graph, each seeing every page ([`src/engine.ts`](../packages/verify/src/engine.ts)). So the work grows with the page count and the checks overlap; no timing claims are made here. To measure your own site instead of trusting prose, add `--timings`: per-stage and per-check wall times print to stderr and the report is unchanged.

## Before step 1: get the CLI

`@seaworthy/verify` is not published to npm yet (pre-alpha; the npm release is Phase 4). The install route this repository already documents is a git install pinned to a commit, from [docs/consumers/theme.md](consumers/theme.md):

```bash
npm install --save-dev github:arminazimi/seaworthy#<commit>
```

Move to the npm package when it is published. Everything below runs through that local install (`npx seaworthy …` in scripts, `seaworthy …` once it is a dev dependency).

## Step 1 — look without failing

Pick the folder your build writes. With no argument, verify takes the first of `dist`, `build`, `out`, `public`, `_site`, `site` that exists; pass the folder explicitly in CI to be unambiguous.

```bash
npm run build   # your build, not Seaworthy's
seaworthy verify dist --fail-on none --max-findings 300 --format llm
```

`--fail-on none` keeps exit 0 no matter how many findings there are; `--max-findings` caps the report so a thousand pages do not print ten thousand lines; `--format llm` gives one compact finding per line, fix first. The cap is safe to look behind: the summary's severity counts cover every finding, capped or not, and the report says how many were omitted under `findingsOmitted`.

The exit codes, whatever step you are in: `0` clean, `1` findings at or above the failing severity, `2` usage error, `4` a check or the engine crashed ([`src/cli/types.ts`](../packages/verify/src/cli/types.ts)).

## Step 2 — record the baseline

```bash
seaworthy verify dist --update-baseline seaworthy-baseline.json
```

This records every finding the engine saw — after suppressions, before any cap, and after the same ignore filters, so a capped or capped-out report still baselines everything — and exits 0. The baseline stores fingerprints with counts, not line numbers ([`src/baseline.ts`](../packages/verify/src/baseline.ts)), so edits that move a finding do not orphan it. **Commit the baseline file.** Add `.seaworthy/` to your `.gitignore`: the `--changed` cache and the run history live there.

One pre-alpha reality: a baseline is stamped with the report spec version, and a Seaworthy that uses a different spec refuses it with an error telling you to re-record. Pin the commit; re-record after a deliberate bump.

## Step 3 — the gate that fails only on new things

Put the baseline in the config so every run applies it, in CI and locally:

```json
{
  "root": "dist",
  "baseline": "seaworthy-baseline.json",
  "failOn": "error"
}
```

```bash
npm run build
seaworthy verify
```

With the default `--fail-on error`, this exits 1 only on findings **not** in the baseline, at error severity or above. A PR that breaks a page link (`links.internal`, error) fails; the site's inherited `images.alt` errors are accepted, listed under `baselined` in the summary, not re-litigated.

Keep `--changed` and `--changed-since` out of the gate. They filter findings by *where the finding is reported* rather than by what changed, and one deleted page produces its findings in every file that linked to it ([`src/changed.ts`](../packages/verify/src/changed.ts)); `--changed-since <ref>` is for sites that commit their build output. CI runs the full verification against the baseline — the graph parse is the cost, and it is the same set of checks either way. Use `--changed` and `--watch` for the local edit-verify loop, where reporting only what moved is the point.

If you want the scaffold instead of the config by hand, `seaworthy init` writes a config, a CI workflow, and an **empty** baseline in one step. On a legacy site, replace that empty baseline with your recorded one before merging the workflow, or day one fails on everything.

## Step 4 — tighten one family at a time

Pick one family, fix it in your **source templates** (fixing built HTML gets overwritten by the next build), then either re-record the baseline or delete nothing: fixed findings stop matching, show up as `baselineStale` in the summary, and the next `--update-baseline` prunes them. The levers that exist:

- **Severity per check or family** in `checks`: `{"headings.*": "warning", "meta.title": "error"}`. An exact ID beats a prefix; a longer prefix beats a shorter one. Raise the gate itself with `--fail-on warning` once warnings are rare.
- **Turn a family off** where you have decided not to look: `"a11y.axe": "off"`. Turning checks off is visible in the config; use it for scoped experiments, not as the default.
- **Accept single findings on purpose** with `suppressions` (or `<!-- seaworthy-ignore … -->` comments in the output): each needs a reason, and an optional `expires` date after which the finding returns and the suppression is reported as `suppress.expired`. Suppressed findings leave `findings` but stay listed under `suppressed` with their reason — nothing is hidden ([docs/configuration.md](configuration.md)).

Two things teams usually want next and Seaworthy does **not** have: a finding budget that shrinks per release (`--max-findings` caps the *report* and never changes the exit code; the budget lever is the baseline file itself), and expiry dates on baseline entries (only suppressions expire). Say so to anyone who asks for them and open an issue rather than improvising config that does not exist.

## The agent loop over a big report

The report is the interface; the rest of this repository is thin adapters over it.

```bash
seaworthy verify --format json --out report-after.json   # deterministic, for agents and for diff
seaworthy verify --format prompt --out FIX.prompt        # one paste-able prompt covering every finding, grouped by file
seaworthy diff report-before.json report-after.json      # new / fixed / unchanged, matched by fingerprint
seaworthy fix --dry-run                                  # ONE unified diff of every suggested edit; changes nothing
```

`seaworthy fix --dry-run` is the only mode — Seaworthy never writes, and applying the diff with `git apply` is the agent's or a person's move, against the source, not the built folder. Findings whose fix needs human input (alt text, say) come out as manual guidance on stderr instead. For a long run an agent can watch findings arrive: `--format ndjson` emits one JSON finding per line as each check finishes. `seaworthy history --format csv` exports the last 30 runs, one row each, for trend lines. The MCP server (`verify_site`) and the GitHub Action are adapters over this same API and own no check logic.

## Warnings that save a week

- **Rendered and network checks are off by default and stay that way on a gate.** `a11y.axe` needs a real browser (`--rendered`), `links.external` hits the network (`--network`); both are opt-in and say so in their metadata. Skipped ones are listed as skipped, never silently passed. A large site can run the offline checks on every PR and the opt-in ones nightly — two invocations, same baseline.
- **The untrusted-input rule is why a large-site run is safe**: Seaworthy parses your HTML and never evaluates it; nothing in the site can make the verifier execute code.
- **First numbers will look embarrassing.** That is the baseline's job, not an alarm. The tightening plan is step 4, family by family, in the order your users feel it: error-severity families first — `links.internal`, `assets.missing`, `meta.lang`, `images.alt` — then the warning families you raised, then the notes.
