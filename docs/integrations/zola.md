# Zola

Zola builds a static site to the `public/` folder, and Seaworthy verifies that built output —
it reads the HTML and assets in `public/`, never your `.html` templates or `config.toml`.

## Install and build

Zola is a single binary (install it with your package manager, `cargo install zola`, or a release
tarball). From the site root:

```bash
zola build          # writes the site to public/
```

`zola build` writes to `public/` unless `build.output_dir` in `config.toml` names another folder.
`public` is one of the folders the CLI looks for by default (`dist`, `build`, `out`, `public`,
`_site`, `site`), so `verify` finds it without being told — but name it in the commands below
anyway, so the recipe does not break when a stray `dist/` sits in the folder.

## Verify locally

The `@seaworthy/verify` package is not on npm yet (pre-alpha), so install the CLI pinned to a
commit of this repository and run it against the built folder. Add it once to a `package.json` in
the site root (`npm init -y` if you do not have one), replacing `<commit>` with a full SHA:

```bash
npm install --save-dev github:arminazimi/seaworthy#<commit>

zola build
npx seaworthy verify public
```

Or run the CLI from a checkout of this repository: `node packages/verify/dist/src/cli.js verify public`
after `npm ci && npm run build` inside the checkout.

If the site is deployed under a subpath (see the base-path note below), point `verify` at it with a
`seaworthy.config.json` in the folder you run from:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "public",
  "basePath": "/my-zola-site/"
}
```

## In CI

Keep Seaworthy as a pinned git devDependency in the `package.json` you just added, commit the
`package-lock.json`, and this job installs it, builds the site, and verifies it. The `npm ci` step
pulls the pinned CLI, so no separate install is needed:

```yaml
name: Verify
on: [push]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Seaworthy         # the pinned git devDependency, from the committed lockfile
        run: npm ci
      - name: Build with Zola           # asset name and version from getzola/zola releases
        run: |
          curl -sSL "https://github.com/getzola/zola/releases/download/v0.23.6/zola-v0.23.6-x86_64-unknown-linux-gnu.tar.gz" | tar xz
          ./zola build
      - name: Verify
        run: npx seaworthy verify public
```

Any non-zero exit fails the step. The CLI's codes: `0` clean, `1` findings at or above the failing
severity (`error` by default, so a site with error findings fails here with `1`), `2` a usage error,
`4` a check crashed. Pass `--fail-on warning` (or `note`, or `none`) to move where the run fails.

## Or run it as an Action

The repository also ships a composite GitHub Action (`action.yml`). It installs and builds the CLI
inside its own checkout, verifies one folder, optionally writes a SARIF 2.1.0 report, and fails the
run at the threshold — so it replaces the install-and-verify steps above:

```yaml
      - name: Verify with Seaworthy
        uses: arminazimi/seaworthy@<commit> # no release tag is cut yet: pin a commit
        with:
          site: public
          threshold: error
          sarif: seaworthy.sarif
```

`site` is relative to your workspace and is the folder the build command above writes to; leave it
empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default),
`warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded
as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI
built from the pinned commit, not a published package.

## Notes

- **Base path.** Seaworthy does not read Zola's `config.toml`. Its base-path detection covers Jekyll
  (`_config.yml`), Astro (`astro.config.*`), Docusaurus (`docusaurus.config.*`), Hugo (`hugo.*` or
  `config.*`), and VitePress (`.vitepress/config.*`) only — Zola is not one of them. Even though a
  Hugo `config.toml` is scanned for its `baseURL`, Zola spells its own key `base_url`, so detection
  finds no base path and treats the site as deployed at the root (`/`). For a project page under
  `/repo/`, set `basePath` in `seaworthy.config.json` or pass `--base /repo/`. Zola's `base_url` is
  what Zola bakes into absolute links; if you leave Seaworthy at `/`, `links.internal` reports those
  `/repo/...` links as missing and `links.base-url` flags the mismatch. Give Seaworthy the base path
  and both resolve correctly.
- **Output folder.** `zola build` defaults to `public/`; change it with `build.output_dir`. When you
  rename it, pass the new name to `verify` (or set `root`), since the default discovery list is fixed.
- **`_headers` and `_redirects`.** Zola copies `static/_headers` and `static/_redirects` to the top
  of `public/` — the Netlify / Cloudflare Pages location. `hosting.headers` and `hosting.redirects`
  read those files at the site root and report malformed lines and paths the build does not serve.
- **Search index.** `build_search_index` writes a `search_index.json` into `public/`. Nothing links
  to it from a page, so `assets.missing` never reads it; the asset checks only care about a file when
  a page references it.
- **Images.** Files under `static/` are copied into `public/` with their original names (no content
  hash). Shortcodes like `resize_image` and `get_image` write processed files under
  `public/processed_images/`. The image and asset checks read the files actually on disk, so a link
  must point at whichever path Zola emits — a `static/` copy or a processed variant. `images.alt`,
  `images.dimensions`, and `images.size` read the `<img>` tags in the built HTML.
- **Sitemap.** Zola writes `sitemap.xml` into the output (RSS/Atom feeds come from `generate.feeds`
  and are separate files). `sitemap.entries` reads `sitemap.xml` and reports entries that name a page
  not in the built site.
- **Network checks are off by default.** The recipe above runs the offline checks. Broken external
  links are `links.external`, a network check: it runs only with `--network` (or `"network": true`
  in the config), and says so.
