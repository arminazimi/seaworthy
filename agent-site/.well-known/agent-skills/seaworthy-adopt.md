---
name: seaworthy-adopt
description: Adopt Seaworthy verification in an existing site in four moves - a first honest look that fails nothing, a committed baseline that freezes today's findings, a CI gate that fails only on new ones, and a status badge once the gate is green. Use when a site already has findings and a day-one gate would start the project with red CI.
---

# Adopt Seaworthy in an existing site

Seaworthy reads built output only, so every command below runs after the site's own build. Four steps, in order: look, freeze, gate, badge. Do not skip ahead of the baseline.

## Before step 1: how to get a runnable CLI today

Seaworthy is pre-alpha: `@seaworthy/*` is not on npm and no release tag exists, so never write `npm i seaworthy` or a `@v1` pin. Two forms are runnable now:

- **devDependency route:** `npm install --save-dev github:arminazimi/seaworthy#<full-commit-SHA>` in the site project, once. Later `npm ci` reinstalls it from the lockfile.
- **CI without a lockfile entry:** `npm install --no-save github:arminazimi/seaworthy#<full-commit-SHA>`, placed **after** the site's own `npm ci` (which wipes `--no-save` installs).

Pin a full commit SHA of `arminazimi/seaworthy` you trust, so the tools cannot drift under you. The commands below are written as `npx seaworthy ...`, the form the repo's own docs use; badge.md also documents a checkout-and-build form, shown in step 4.

## 1. First honest look (fails nothing)

From the site root, with the site built:

```bash
npx seaworthy verify --fail-on none --format json --out seaworthy-report.json
```

- Without a folder argument, verify takes the first existing of `dist`, `build`, `out`, `public`, `_site`, `site`; pass the folder explicitly if yours differs.
- `--fail-on none` reports every finding at every severity but exits 0 (exit 4 only when a check or the engine crashed). Exit codes everywhere: 0 clean, 1 findings at or above the failing severity (default `--fail-on error`), 2 usage error, 4 crash.
- Read `seaworthy-report.json`: `summary.bySeverity` gives the shape, and each finding carries a check ID, a file location, and a fix hint.

Do not wire CI yet. A gate on a site with known findings teaches everyone to ignore red CI.

## 2. Freeze what already exists: a committed baseline

```bash
npx seaworthy verify --update-baseline seaworthy-baseline.json
```

- This records all current findings in `seaworthy-baseline.json` and then exits 0 (4 when a check crashed - the printed warning says the baseline may be incomplete; fix and re-record). Commit the file.
- The baseline stores **fingerprints with counts, not line numbers**, so it survives edits that move a finding to another line.
- From now on verify fails only on findings the baseline does not accept:

  ```bash
  npx seaworthy verify --baseline seaworthy-baseline.json
  ```

  Better: add `"baseline": "seaworthy-baseline.json"` to `seaworthy.config.json` (verify reads that file from the current folder by default) and every run, CI included, applies it.

- Working the baseline down: fix findings in the site source, rebuild, re-verify. Findings you fixed show up as `summary.baselineStale` in the report; run `--update-baseline` again to prune them. Never hand-edit a baseline - it records accepted findings, and only `--update-baseline` should write it.

## 3. Gate future changes in CI

Add a workflow that builds the site and runs the gate. No `continue-on-error` on the verify step: the gate is its exit code, and it fails only on findings the committed baseline does not accept.

```yaml
name: seaworthy
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build the site
        run: |
          npm ci
          npm run build
      - name: Install Seaworthy (pre-alpha: pin a full commit SHA)
        run: npm install --no-save github:arminazimi/seaworthy#<TRUSTED-SHA>
      - name: Verify
        run: npx seaworthy verify
```

Adapt the build step to the project (Hugo, Jekyll, and committed-output Pages sites have no `npm run build`).

**The one-step alternative - what `seaworthy init` actually writes.** Run in the project folder (the source, not the built output). It detects the generator from marker file names only - Astro, Docusaurus, Hugo, Jekyll, or GitHub Pages - and writes three files: `seaworthy.config.json` (the generator's output folder plus the baseline), `.github/workflows/seaworthy.yml` (a build step for the generator, then a bare `npx seaworthy verify` step), and an **empty** `seaworthy-baseline.json`. Two consequences to know before using it: the empty baseline means every current finding fails until you complete step 2 locally and commit the recorded file, and the workflow's bare `npx seaworthy verify` line needs the step 3 install added above it while the CLI is pre-alpha. A second run leaves existing files alone; `--force` rewrites the config and the workflow it owns, but a baseline is never rewritten. The repo also ships a composite GitHub Action (`action.yml`; inputs are exactly `site`, `threshold`, `sarif`); its documented `@v1` tag pin does not exist yet, so until the first release call it from a full SHA: `uses: arminazimi/seaworthy@<TRUSTED-SHA>`.

## 4. Show the badge once the gate is green

Only after step 3 passes: the badge is the public claim, the gate is the promise behind it. Per [docs/badge.md](../../docs/badge.md): the badge is a plain SVG the repository commits and GitHub serves from the commit - no hosted endpoint, no signup. `seaworthy-badge` (in `@seaworthy/action`) is a pure function of the report: it reads only `summary.bySeverity` and the crashed-check `errors` array, exits 0 for any readable report (2 for a malformed one), and never fails because the site has findings. Same mapping as the default gate:

| Report                              | Badge state | Color |
| ----------------------------------- | ----------- | ----- |
| only notes, or nothing at all       | `passing`   | teal  |
| one or more `warning` findings      | `warnings`  | amber |
| one or more `error` findings or crashes | `failing` | red, count = errors |

Add to the workflow that builds the site (the documented form checks this repository out at a trusted SHA, builds it, and runs both CLIs from that build):

```yaml
- uses: actions/checkout@v4
  with: { repository: arminazimi/seaworthy, ref: <TRUSTED-SHA>, path: seaworthy, persist-credentials: false }
- uses: actions/setup-node@v4
  with: { node-version: 22, cache: npm, cache-dependency-path: seaworthy/package-lock.json }
- run: npm ci && npm run build
  working-directory: seaworthy
- run: node seaworthy/node_modules/@seaworthy/verify/dist/src/cli.js verify --format json --out seaworthy-report.json
  continue-on-error: true # the badge must still be written when the gate fails
- run: node seaworthy/packages/action/dist/src/badge-cli.js --report seaworthy-report.json --out seaworthy-badge.svg
- run: |
    git config user.name seaworthy-bot
    git config user.email seaworthy-bot@users.noreply.github.com
    git add seaworthy-badge.svg
    git commit -m "chore: refresh seaworthy badge" || true
    git push
```

Because the report is deterministic, a rerun never dirties the working tree. Keep the step 3 gate strict: `continue-on-error` belongs only on the report-writing step above, never on the gate itself. Then paste the snippet into the README, substituting `OWNER`, `REPO`, `BRANCH` (it is also printed by `seaworthy-badge --readme`):

```markdown
[![seaworthy verified](https://raw.githubusercontent.com/OWNER/REPO/BRANCH/seaworthy-badge.svg)](https://github.com/arminazimi/seaworthy)
```

## Invariants

- Seaworthy reports and suggests; it never edits the site's files. Fixes happen in the site source, then rebuild, then re-verify.
- The baseline file records accepted findings: commit it, shrink it by fixing findings, and rewrite it only with `--update-baseline`.
- Keep JSON output deterministic (`--format json --out`); the badge and any tooling read the same report shape.
