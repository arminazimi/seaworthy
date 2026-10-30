# GitLab CI

Verify a built static site as a GitLab CI job: build it, then run Seaworthy against the folder the build writes — in the example below `dist`. Seaworthy reads the built HTML and assets only; it never runs or imports your generator, and GitLab does the building.

GitLab CI is not GitHub Actions, so this repo's `action.yml` (a composite GitHub Action) does not apply here — the recipe uses the CLI directly.

## Install and build

Use the `node:22` image (the CLI requires Node.js 22 or newer). Build the site with its own commands, then verify the output folder.

`@seaworthy/verify` is not published yet (pre-alpha), so install the CLI from git pinned to a commit. Put the install **after** `npm ci`, which wipes `node_modules` and would otherwise remove a `--no-save` install placed before it:

```yaml
verify:
  stage: build
  image: node:22
  script:
    - npm ci                                                   # the site's own dependencies
    - npm run build                                            # writes dist/ — use your build command and folder
    - npm install --no-save github:arminazimi/seaworthy#<commit> # pre-alpha: from git, pinned; after npm ci so it survives
    - npx seaworthy verify dist
```

Swap the git install for `npm install seaworthy` once the package is published.

## Verify locally

The same command runs from a checkout, so you can reproduce a failed pipeline before pushing:

```bash
npx seaworthy verify dist
```

Add `seaworthy.config.json` in the folder you run from when the site is deployed under a subpath, when you want a stricter threshold, or when you want the report as a file:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "dist",
  "failOn": "error"
}
```

## Fail the job on findings

`npx seaworthy verify dist` exits `0` when there are no findings at or above the failing severity, `1` when there are, `2` on a usage error, and `4` when a check or the engine crashes. Every non-zero exit fails the script step.

Set `allow_failure: false` (the GitLab default, shown explicitly for clarity) so the failed step is a blocking failure and the pipeline stops. With `allow_failure: true` the job is marked as a warning and the pipeline keeps going, which is what you want only if you do not gate on Seaworthy:

```yaml
verify:
  # … script and image as above …
  allow_failure: false
```

Tighten or loosen the threshold with `--fail-on`, which accepts `error` (default), `warning`, `note`, or `none`.

## Keep the report as an artifact

Write a SARIF 2.1.0 report and hand it to GitLab with `artifacts`, so it survives the job and can be downloaded or fed to a code-quality viewer:

```yaml
verify:
  stage: build
  image: node:22
  script:
    - npm ci
    - npm run build
    - npm install --no-save github:arminazimi/seaworthy#<commit>
    - npx seaworthy verify dist --format sarif --out seaworthy.sarif
  allow_failure: false
  artifacts:
    when: always
    paths:
      - seaworthy.sarif
```

`--format` also accepts `pretty` (default), `json`, `markdown`, `llm`, `prompt`, `html`, or `ndjson`; `--out` writes the report to a file and prints a one-line summary. `when: always` keeps the report even when the job fails, which is exactly when you want to read it.

## Notes

- **Base path.** Seaworthy detects a deploy base path only from five generator configs — Jekyll (`_config.yml`), Astro (`astro.config.*`), Docusaurus (`docusaurus.config.*`), Hugo (`hugo.*`/`config.*`), and VitePress (`.vitepress/config.*`). It reads no CI or host config, so it does not learn GitLab's deploy path from `.gitlab-ci.yml`. If the site is served under a subpath, set `basePath` in `seaworthy.config.json` or pass `--base /path/` to the verify step; otherwise verification runs against the root (`/`).
- **Folder discovery.** With no folder argument, Seaworthy verifies the first existing of `dist`, `build`, `out`, `public`, `_site`, `site`. If your build writes a different folder, name it on the command line.
- **Pin a commit.** No release tag exists yet, so `<commit>` is a real commit SHA you chose, not `main`; a floating ref makes the job irreproducible.
- Seaworthy reports and suggests; it never edits your files and never deploys.
