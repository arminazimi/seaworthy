# Gatsby

`gatsby build` writes a complete static site to `public/` at the project root, and Seaworthy verifies that folder like any other built output: one report, every finding with a check ID, a location, and a fix hint. Seaworthy reads the built files only — it never runs or imports Gatsby, and this repository ships no Gatsby code and adds no dependency.

## Install

Seaworthy is pre-alpha: `npx seaworthy` is not on npm yet. Add it to your Gatsby project as a devDependency pinned to a commit of this repository, and the `seaworthy` command becomes available through `npx`:

```bash
npm install --save-dev github:arminazimi/seaworthy#<commit>
```

Move to the npm package when it is published.

## Build, then verify

From the project root (create a site with `npm init gatsby` if you do not have one yet):

```bash
npm ci                 # the site's own dependencies (or npm install on a fresh project)
npm run build          # gatsby build; writes the site to public/
npx seaworthy verify public
```

`public` is one of the folders Seaworthy tries when you give it no argument (it goes through `dist`, `build`, `out`, `public`, `_site`, `site` in that order), so a bare `npx seaworthy verify` finds it once the site is built. Name `public` explicitly anyway — it says which folder the report is about.

### Base path: `pathPrefix` is yours to mirror

Gatsby's own `pathPrefix` in `gatsby-config.js` changes the URLs Gatsby emits — built with `--prefix-paths`, a link to `/about/` becomes `/blog/about/` — and Seaworthy does not read any Gatsby config: its base-path detection covers Jekyll, Astro, Docusaurus, Hugo, and VitePress configs only. Say the same value yourself, in `seaworthy.config.json` in the folder you run the CLI from:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "public",
  "basePath": "/blog/"
}
```

or pass it for a single run:

```bash
npx seaworthy verify public --base /blog/
```

Keep the two in step: `pathPrefix` reaches the built HTML only when the build used `--prefix-paths`, so the base path Seaworthy gets must match what the build actually emitted — a plain `gatsby build` writes unprefixed URLs and wants the default `/`. With the base path missing or wrong, [links.base-url](../checks/links.base-url.md) and [links.internal](../checks/links.internal.md) see the prefixed links as pointing outside the built site.

## Verify on every build (gatsby-node snippet)

Gatsby has a real post-build API, `onPostBuild` in `gatsby-node.js`, so the build itself can fail the moment Seaworthy finds problems. This snippet is for **your own project**; this repository neither ships nor tests it, and it adds no dependency — it only shells out to the CLI you installed above:

```js
// gatsby-node.js — runs `seaworthy verify` on the folder Gatsby just wrote, and fails the build on findings.
const { spawnSync } = require("node:child_process");

exports.onPostBuild = () => {
  const run = spawnSync("npx", ["seaworthy", "verify", "public"], { stdio: "inherit" });
  if (run.status !== 0) {
    throw new Error(`seaworthy verify exited with code ${run.status}`);
  }
};
```

`onPostBuild` runs after Gatsby has written `public/`, so `npm run build` becomes build and verify in one step. With it, drop the separate verify step below.

## In CI

One job that builds, then verifies:

```yaml
name: verify
on:
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
          node-version: 22
      - name: Build the site
        run: |
          npm ci
          npm run build        # gatsby build; writes public/
      - name: Verify
        run: npx seaworthy verify public
```

No separate install step for Seaworthy: it is a devDependency pinned in your `package.json` (Install above), so the site's own `npm ci` installs it.

The verify step is the gate, on the CLI's exit-code contract: `0` when nothing reaches `--fail-on` (default `error`), `1` when there are findings at or above it, `2` for a usage error, and `4` when a check crashes. Any non-zero exit fails the job, so it is the `1` — your site's findings — that turns the check red.

## Or run it as an Action

The repository also ships a composite GitHub Action (`action.yml`). It installs and builds the CLI inside its own checkout, verifies one folder, optionally writes a SARIF 2.1.0 report, and fails the run at the threshold — so it replaces the install-and-verify steps above:

```yaml
      - name: Verify with Seaworthy
        uses: arminazimi/seaworthy@<commit> # no release tag is cut yet: pin a commit
        with:
          site: public
          threshold: error
          sarif: seaworthy.sarif
```

`site` is relative to your workspace and is the folder the build command above writes to; leave it empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default), `warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI built from the pinned commit, not a published package.

## Notes for Gatsby

- **Hashed assets are fine.** `gatsby-plugin-image` and `gatsby-plugin-sharp` write optimized, content-hashed image files under `public/static/`, and per-page data as JSON under `public/page-data/`. The checks read the built HTML and the files on disk — [assets.missing](../checks/assets.missing.md) resolves a hashed URL exactly like a plain one, so the hashing changes nothing.
- **Images come from the built markup.** The prerendered HTML carries the real `<img>` elements, so [images.alt](../checks/images.alt.md) and [images.dimensions](../checks/images.dimensions.md) judge what a browser gets: an `alt` or width/height you did not pass to `GatsbyImage` shows up as a finding.
- **Sitemap.** `gatsby-plugin-sitemap` writes `public/sitemap.xml`, and [sitemap.entries](../checks/sitemap.entries.md) reads it and reports every entry that is not a page in the build. With no sitemap there is nothing to read.
- **`_headers` and `_redirects`.** `gatsby-plugin-netlify` lands both files at the top of `public/`, which is exactly where [hosting.headers](../checks/hosting.headers.md) and [hosting.redirects](../checks/hosting.redirects.md) read them — malformed lines and paths the build does not serve are reported. On other hosts, put headers and redirects wherever that host's own mechanism reads them; these two checks then have nothing to see.
- **Client-only routes.** An `@reach/router`-style client-only app answers its extra routes from JavaScript, so those pages are not HTML files in `public/`, and the checks read the built files: a link into a client-only route points at a page the build does not contain, and `links.internal` reports it.
- **`seaworthy init` does not know Gatsby.** Its generator detection reads marker files for Jekyll, Astro, Docusaurus, Hugo, and GitHub Pages only, so it will not write a Gatsby config or workflow. Write `seaworthy.config.json` by hand, as above.
- **Findings point inside `public/`.** A location names the generated file, not the source in `src/` or `gatsby-config.js` that produced it. Fix the source, rebuild, verify again.
