# Astro

Astro builds a static site into `dist/` (or the folder you set in `build.outDir`), and Seaworthy verifies that folder: broken links, missing assets, a wrong base path, alt text, agent-readable pages, one report with locations and fix hints.

Seaworthy reads built output only. It never imports Astro, runs the dev server, or needs an Astro dependency — and this repository ships no Astro code. The integration snippet below is a file for **your** project; copy it, do not expect it from `npm`.

## Install and build

Astro's own commands, run from the project root:

```bash
npm install                    # project dependencies, Astro included
npm run build                  # astro build, writing dist/
```

Seaworthy is pre-alpha and not on the npm registry yet, so `npx seaworthy` does not resolve today. Once it is published the commands below work as written. Until then, run the CLI from a clone of this repository:

```bash
npm ci && npm run build        # in the seaworthy clone
node packages/verify/dist/src/cli.js verify /path/to/your/project/dist
```

## Verify locally

From the Astro project root, name the folder explicitly:

```bash
npx seaworthy verify dist
```

Naming the folder matters here. With no argument, Seaworthy verifies the first of `dist`, `build`, `out`, `public`, `_site`, `site` that exists — and an Astro project that has not been built yet still has a source `public/`, so the run would check your source files instead of the build.

A config is optional. Add `seaworthy.config.json` in the folder you run from when you want the settings to travel with the project:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "dist",
  "ignore": ["drafts/**"]
}
```

With `root` set, a plain `npx seaworthy verify` reads the same folder as the command above. See [configuration.md](../configuration.md) for `failOn`, `basePath`, `checks`, and baselines.

## Run Seaworthy as part of the Astro build

Astro integrations can hook `astro:build:done`, which runs after the build has written its output and receives that output folder as `dir` (a file URL). Keeping the hook small and shelling out to the CLI is the whole integration: the same checks, the same exit codes, no Astro types imported.

`astro-integration-seaworthy.mjs`, in your project:

```js
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function seaworthyAfterBuild() {
  return {
    name: "astro-integration-seaworthy",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const result = spawnSync("npx", ["seaworthy", "verify", fileURLToPath(dir)], { stdio: "inherit" });
        if (result.status !== 0) {
          logger.error(`seaworthy verify exited with code ${result.status}`);
          throw new Error("Seaworthy did not accept the built site.");
        }
      },
    },
  };
}
```

Register it in `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import seaworthyAfterBuild from "./astro-integration-seaworthy.mjs";

export default defineConfig({
  integrations: [seaworthyAfterBuild()],
});
```

`stdio: "inherit"` puts the findings in the build log. A non-zero exit makes the hook throw, which fails `astro build`, so a broken site never leaves the build step green. Findings at or above `--fail-on` (default `error`) exit 1, a wrong invocation exits 2, and a crashed check exits 4 — all of them fail the build here.

This snippet is userland code you keep and test in your own project. Nothing in this repository loads it, and adding it adds no dependency to this repository.

## In CI

One job builds, then verifies. `seaworthy init` writes this workflow for an Astro project, `root` set to `dist` included.

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
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Build the site
        run: |
          npm ci
          npm run build
      - name: Verify
        run: npx seaworthy verify dist
```

Exit 0 passes the step. Exit 1 (findings at or above the `--fail-on` level), 2 (usage error — a common one is `dist` missing because the build wrote elsewhere), and 4 (a check crashed) all fail the job, so the run stops before deploy. If you use the integration above, drop the Verify step: `npm run build` already fails on findings.

## Or run it as an Action

The repository also ships a composite GitHub Action (`action.yml`). It installs and builds the CLI inside its own checkout, verifies one folder, optionally writes a SARIF 2.1.0 report, and fails the run at the threshold — so it replaces the install-and-verify steps above:

```yaml
      - name: Verify with Seaworthy
        uses: arminazimi/seaworthy@<commit> # no release tag is cut yet: pin a commit
        with:
          site: dist
          threshold: error
          sarif: seaworthy.sarif
```

`site` is relative to your workspace and is the folder the build command above writes to; leave it empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default), `warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI built from the pinned commit, not a published package.

## Notes

- **`build.outDir`.** Anything other than `dist` means passing that folder to `verify`, or setting `root` to it. Seaworthy guesses nothing about the build.
- **`base`.** Seaworthy reads the `base` setting from `astro.config.mjs`, `.js`, `.ts`, or `.mts` — beside the built folder or in the project root — and verifies every internal URL under it. It reads a plain string literal only: a `base` built from `process.env`, a template literal, or a conflicting second value falls back to `/`, and the report says why. `astro.config.cjs` is not read, and `site` (the domain) is not the base path. Set `basePath` in `seaworthy.config.json` or pass `--base /repo/` to decide it yourself.
- **`trailingSlash` and `build.format`.** No setting on the Seaworthy side. Links are resolved the way a static host serves them — `/about`, `/about.html`, and `/about/` all reach `about/index.html` — so both styles verify. What fails is a URL that matches no file, which is exactly what happens when a redirect rule or a hand-written link disagrees with the style the build emits.
- **Image optimization.** `astro:assets` writes optimized files under `_astro/` and gives `<Image>` real `width` and `height`, so `images.dimensions` passes and `assets.missing` finds the file. Hand-written `<img>` tags are checked against the file that is actually in `dist`, so a path you typed for an asset the optimizer moved or renamed shows up as missing. `images.size` budgets 500 KB per local image by default; raise it with `checks."images.size".options.maxBytes`.
- **`_headers` and `_redirects`.** The Netlify and Cloudflare Pages adapters copy these into the output, and `hosting.headers` and `hosting.redirects` read them at the top of the folder: a malformed line is reported, and so is a path the build does not serve, because both hosts skip those silently.
- **`output: "server"`.** With an adapter the pages are rendered per request; the build writes static files (under `dist/client`) and server entry code (under `dist/server`), and verifying reads the files that exist. Request-rendered pages are not files yet, so a server-rendered site verifies its static half this way — a static build (`output: "static"`, the default) is what gets checked page by page.
- **Sitemap.** The sitemap integration writes `dist/sitemap.xml`. `sitemap.entries` checks every `<loc>` against the build, and a page listed there is never reported as an orphan by `quality.orphans`.
