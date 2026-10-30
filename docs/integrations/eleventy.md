# Eleventy

Seaworthy verifies the built site an Eleventy project writes: by default `npx @11ty/eleventy` emits to `_site`, and Seaworthy reads that folder as plain HTML and assets. It never runs Eleventy and never reads `eleventy.js`, so the recipe ends at your build step.

## Build, then verify

Install and build with Eleventy's own commands. Requires Node.js 18 or newer to build and Node.js 22 or newer to run Seaworthy, so use 22 for both.

```bash
npm ci                 # the project's own dependencies, Eleventy among them
npx @11ty/eleventy     # builds to _site (printed as the output folder when it finishes)
```

`--output <dir>` in the Eleventy CLI changes where the build writes; if you pass it, verify the folder you named instead of `_site`.

Verify locally with the CLI:

```bash
seaworthy verify _site
```

`_site` is one of the folders the CLI discovers on its own (the first existing of `dist`, `build`, `out`, `public`, `_site`, `site`), so a bare `seaworthy verify` usually finds it. Naming it is still the better habit: discovery takes the **first** folder that exists, so a stray `dist/` or `public/` in the same project is checked instead of your Eleventy output. An explicit `seaworthy verify _site` always checks the folder the build just wrote.

> **Pre-alpha.** `npx seaworthy` and the published package do not exist yet. From a checkout of this repository, run the built CLI: `node packages/verify/dist/src/cli.js verify _site` (after `npm run build`). Every command below assumes a working `seaworthy` on your `PATH`.

## A site served from a subpath

A project page served at `https://<user>.github.io/<repo>/` puts its pages under `/repo/`. Seaworthy does **not** read Eleventy's config, so it cannot guess this — a base path is only detected from Jekyll, Astro, Docusaurus, Hugo, and VitePress configs. State it yourself, in `seaworthy.config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "_site",
  "basePath": "/repo/"
}
```

or for one run, on the command line:

```bash
seaworthy verify _site --base /repo/
```

With the base path set, `links.base-url` checks root-absolute links against `/repo/` and `links.internal` resolves them within the site. Without it, Seaworthy assumes the site is at the domain root and reports the mismatch.

## In CI

Build the site, then verify the folder. The CLI's exit codes are `0` clean, `1` findings at or above the failing severity (`error` by default), `2` usage error, and `4` crash — so the job fails when `seaworthy verify` exits non-zero, and the exit you normally hit on a real problem is `1`.

```yaml
name: Verify the site
on: [push]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Install site dependencies
        run: npm ci
      - name: Build with Eleventy
        run: npx @11ty/eleventy
      - name: Install Seaworthy # pre-alpha: from git, pinned; swap to npm once it is published
        run: npm install --no-save github:arminazimi/seaworthy#<commit>
      - name: Verify
        run: seaworthy verify _site
```

The Seaworthy install step comes **after** `npm ci`, which deletes `node_modules` and would wipe a `--no-save` install placed before it. Replace `<commit>` with the commit you want to pin; the CLI then runs from that pinned source, not a published package. If you add Seaworthy to the project's `package.json` as a pinned git devDependency instead, `npm ci` installs it and the extra step is not needed.

## Or run it as an Action

The repository also ships a composite GitHub Action (`action.yml`). It installs and builds the CLI inside its own checkout, verifies one folder, optionally writes a SARIF 2.1.0 report, and fails the run at the threshold — so it replaces the install-and-verify steps above:

```yaml
      - name: Verify with Seaworthy
        uses: arminazimi/seaworthy@<commit> # no release tag is cut yet: pin a commit
        with:
          site: _site
          threshold: error
          sarif: seaworthy.sarif
```

`site` is relative to your workspace and is the folder the build command above writes to; leave it empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default), `warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI built from the pinned commit, not a published package.

## Eleventy notes

What your Eleventy settings change about what the checks see:

- **Permalinks decide the URLs the checks follow.** `permalink: /about/` (the default "pretty" style) writes `about/index.html`; `permalink: /about.html` writes `about.html`. `links.internal` resolves both styles — it maps a path ending in `/` to `index.html` inside that folder and otherwise tries the file, then `.html`, then `/index.html`. It reports a finding only when the link does not match what the build actually emitted, so a page built as `about.html` and linked as `/about/` (or the reverse) is a broken link to Seaworthy. Pick one permalink style and link to it consistently.
- **Collections and `eleventyNavigation` are how links get made, but the checks see only the output.** A navigation from the Eleventy navigation plugin or a loop over a collection renders ordinary `<a href>` elements in the built HTML; `links.internal` follows those, and `quality.orphans` warns about any page no other page links to. So a page left out of the navigation shows up as an orphan. Seaworthy reads the emitted HTML, not your templates or collection definitions.
- **Images reach `_site` through passthrough file copy.** Files under your input directory are only in the built site if Eleventy copies them — `addPassthroughCopy()` (or `templateFormats`) for assets outside the templates. An `<img>` whose `src` points at a file that was never copied into `_site` triggers `assets.missing` (the referenced file is not in the built site), independent of `images.alt` and `images.dimensions`, which judge the `<img>` tag itself.
- **`_headers` and `_redirects` are checked only if you add them.** Nothing in Seaworthy assumes Netlify or Cloudflare Pages. If you pass one of those files through to `_site`, `hosting.headers` checks `_headers` for malformed lines and paths the site does not serve, and `hosting.redirects` does the same for `_redirects`; if the files are absent, neither check reports anything.
- **Sitemaps, if you generate one.** A `sitemap.xml` you build as an Eleventy template is read like any other file: `sitemap.entries` reports URLs the sitemap lists that are not in the built site. If you do not generate a sitemap, nothing here changes.
- **Offline by default.** Checks make no network calls and run no browser unless you opt in with `--network` or `--rendered`, so verifying `_site` stays fast and reproducible.
