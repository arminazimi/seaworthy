# Recipe: VitePress

VitePress builds a static site into `docs/.vitepress/dist` (the default `outDir`, relative to your VitePress `srcDir`); this recipe verifies that built folder with Seaworthy. Seaworthy reads only the built HTML and assets, so it never runs VitePress and does not import its config — you build first, then point `seaworthy verify` at the output folder.

> Seaworthy is pre-alpha and `npx seaworthy` is not published yet. Install it from git, pinned to a commit, until the npm release: `npm install --save-dev github:arminazimi/seaworthy#<commit>`. The commands below assume that local install, so `seaworthy` resolves from `node_modules/.bin`.

## Build

VitePress is a dependency of your own project, not of this repository. Add it and a build script, then build to the output folder:

```bash
npm install --save-dev vitepress
```

```json
// package.json
{
  "scripts": {
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs"
  }
}
```

```bash
npm run docs:build
```

This writes the site to `docs/.vitepress/dist`. Nothing here runs Seaworthy yet.

## Verify locally

Point the CLI at the built folder. Forward slashes keep the path identical on every platform:

```bash
seaworthy verify docs/.vitepress/dist
```

Seaworthy exits 1 here because the fresh build still has findings. Read the report, fix the source in your Markdown and config, rebuild, and run the command again until it exits 0.

Set the base path in `seaworthy.config.json` in the folder you run from. VitePress serves the site under the `base` you set in its config, and Seaworthy needs the same value to resolve links and assets correctly:

```json
{
  "root": "docs/.vitepress/dist",
  "basePath": "/docs/"
}
```

With `root` set, `seaworthy verify` finds the built folder on its own, so the bare command and the explicit path do the same thing:

```bash
seaworthy verify
```

Or pass the base for one run with `--base`, which overrides the config:

```bash
seaworthy verify docs/.vitepress/dist --base /docs/
```

## In CI

One job builds the site, then verifies the output folder. The verify step's exit code is the CLI's contract (0 clean, 1 findings at or above the threshold, 2 usage, 4 crash), so the build step and the verify step both fail the job on a non-zero exit:

```yaml
name: Verify docs
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run docs:build
      - name: Verify the built site
        run: npx seaworthy verify docs/.vitepress/dist
```

`npm run docs:build` writes `docs/.vitepress/dist`; the verify step reads that folder and exits 1 when it finds a problem at or above the threshold, which fails the job. It exits 0 only when the built site is clean, so the build step passing is not enough on its own — the verify step is what gates the merge. The usage (2) and crash (4) codes also stop the job, so a typo in a flag never looks like a passing run.

## Optional: verify from the VitePress build

VitePress has a real extension point: the `buildEnd` hook in its config runs after the build finishes, in the same process, and receives the site config (including `outDir`). You can shell out to the CLI there so a build that produces findings fails immediately. This snippet is for **your** project's `docs/.vitepress/config.mts` — it is not code this repository ships or tests:

```ts
// docs/.vitepress/config.mts — a snippet to copy into your project, not Seaworthy code
import { execFileSync } from 'node:child_process'

export default {
  base: '/docs/',
  buildEnd(siteConfig) {
    // siteConfig.outDir is the built folder; verify exactly what was just written.
    execFileSync('npx', ['seaworthy', 'verify', siteConfig.outDir, '--base', '/docs/'], { stdio: 'inherit' })
  },
}
```

If you use this hook, drop the separate verify step from CI so the build already carries the check. Prefer the CI job above if you would rather keep the build and the verify as distinct steps.

## Notes specific to VitePress

- **Base path.** Detection reads the base from a `.vitepress/config.*` file sitting next to the folder you verify or in its parent. In the usual layout the config lives two levels above `docs/.vitepress/dist`, so it is **not** picked up automatically — set `basePath` in `seaworthy.config.json` or pass `--base`, and make it match VitePress's own `base`.
- **Clean URLs.** VitePress's `cleanUrls: true` strips `.html` from the links it emits and serves `/about` for `about.html`. Seaworthy resolves a link to `<path>.html` and to `<path>/index.html`, so clean links still point at the built pages; keep `cleanUrls` on and there is nothing extra to set.
- **Hashed assets.** VitePress (Vite) fingerprints bundled JS and CSS under `assets/` by default. That does not change verification: Seaworthy checks the file names actually present in the built folder, so a hashed asset link that resolves is clean, and one that does not is a real broken link.
- **`_headers` and `_redirects`.** VitePress does not write these host files. On Netlify or Cloudflare Pages, add them to your VitePress `srcDir/public/` so the build copies them into `dist`; `hosting.headers` and `hosting.redirects` then read them from the built folder.
- **Images.** Alt text and other image findings point at the built HTML, but you fix them in the Markdown source. Edit the `.md`, rebuild with `npm run docs:build`, and verify again.
