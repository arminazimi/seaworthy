# GitHub Pages

Seaworthy checks the folder your Pages build writes to — the same folder `actions/upload-pages-artifact` names in its `path:` — before the artifact is uploaded, so a broken internal link or a missing asset fails the run instead of shipping to `github.io`. It reads built output only; it does not run your generator, does not deploy, and never edits files.

## Where the step goes

The official **Deploy static content to Pages** workflow is, in order: `actions/checkout@v4`, `actions/configure-pages@v5`, a build step, `actions/upload-pages-artifact@v4` with a `path:`, and `actions/deploy-pages@v4` in a job whose `environment:` is `github-pages`. Seaworthy is one step between the build and the upload, pointed at the folder `path:` names:

```yaml
      - name: Build the site
        run: npm ci && npm run build        # writes _site here

      - name: Verify the built folder       # after the build, before the upload
        run: npx seaworthy verify _site --base /repo/

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: '_site'                     # the same folder verify just checked
```

Point `verify` at exactly the folder `path:` names. If you leave the folder off, the CLI picks the first of `dist`, `build`, `out`, `public`, `_site`, `site` that exists — which is not necessarily your artifact folder.

## The base path

Pages has two shapes, and only one of them needs a base path:

- A **project page** lives at `https://<user>.github.io/<repo>/`. Pages serves the artifact under `/repo/` and does **not** rewrite paths, so the built links must already carry `/repo/`. Tell Seaworthy the same so `links.base-url` and `links.internal` compare links against it.
- A **user or organisation page** (`https://<user>.github.io/`), and any site that sets a custom domain through a `CNAME` file, sits at the domain root: the base path is `/` and nothing needs setting.

Pass the project-page base path one of three ways. Precedence is `--base`, then `basePath` in the config, then detection from a generator config, then `/`:

- `--base /repo/` on the command line (shown above),
- `"basePath": "/repo/"` in `seaworthy.config.json` (read from the folder you run in),
- base-path detection. It reads the generator configs it knows — a Jekyll `_config.yml` (`baseurl`) or a Hugo `hugo.toml` (`baseURL`), plus Astro, Docusaurus, and VitePress — when the config sits next to the built folder or one folder up. **Nothing else is read.** A plain static folder, or a generator outside that list, gets `/` unless you set `basePath` or `--base` yourself.

The config file is the tidy option when you would otherwise repeat `--base` in several places, and it is the only option the Action form has (below). Keys are `root` (the built folder) and `basePath`:

```json
{
  "root": "_site",
  "basePath": "/repo/"
}
```

With that file at the repo root, a bare `npx seaworthy verify` reads the folder and the base path on its own.

## Verify locally

Build the site first, then run verify against the same folder you will upload. Seaworthy is **pre-alpha** and `@seaworthy/verify` is not published to npm yet, so `npx seaworthy` does not resolve from the registry — install it from a pinned commit, or run the CLI built from this repository.

```bash
npx seaworthy verify _site --base /repo/     # pre-alpha: install first, see the CI job below
```

## In CI

The verify step runs the CLI, so it needs Seaworthy installed first. Add it after the site's own `npm ci` — running `npm ci` deletes `node_modules` and would wipe a `--no-save` install placed before it.

```yaml
name: Deploy static content to Pages
on:
  push:
    branches: ["main"]
permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5

      - name: Build the site
        run: npm ci && npm run build           # writes _site

      - name: Install Seaworthy                # pre-alpha: from git, pinned; swap to npm once it is published
        run: npm install --no-save github:arminazimi/seaworthy#<commit>
      - name: Verify the built folder          # fails the deploy on findings at or above --fail-on
        run: npx seaworthy verify _site --base /repo/

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: '_site'
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

The exit code is the CLI's own contract: `0` clean, `1` findings at or above the failing severity (`error` by default; `--fail-on warning|note|none` to change it), `2` usage error, `4` a check crashed. A non-zero `npx` exit fails the step, so the job stops before `upload-pages-artifact` and `deploy-pages` run — a broken site never deploys.

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

One Pages-specific catch: the Action passes only `site`, `threshold`, and `sarif` to the CLI — it has no `--base` input. For a project page, carry the base path through `"basePath": "/repo/"` in a committed `seaworthy.config.json`, or leave it to detection of a Jekyll or Hugo config sitting next to the built folder or one up.

## Notes

- **`.nojekyll`.** Pages runs Jekyll over the artifact unless a `.nojekyll` file is present, and Jekyll drops entries whose names start with an underscore. So `_headers`, `_redirects`, and other underscore files can be missing from the deployed site even though they are in the folder Seaworthy checked — `hosting.headers` and `hosting.redirects` pass on disk while the live site has no such files. Add `.nojekyll` when you publish a build that already contains them.
- **`CNAME`.** A `CNAME` file points a custom domain at the site. The base path is then `/`, so do not set `basePath` or `--base`; links that start at the domain root are correct.
- **What the checks see.** Seaworthy reads the built folder on disk only. `links.internal` and `links.base-url` compare internal links against the files and the base path; `assets.missing` and `sitemap.entries` check referenced files and the sitemap; `quality.orphans` flags pages nothing links to. External-link checks such as `links.external` are off by default and run only with `--network`.
- **The boundary.** Seaworthy does not deploy, does not know Pages' routing rules, and cannot see what the Pages pipeline does to the artifact after upload — the `.nojekyll` stripping above is exactly the kind of post-upload change a disk check cannot observe. It verifies the folder you hand it, and stops there.
- **`seaworthy init`.** Init detects GitHub Pages markers (a top-level or `docs/` `.nojekyll` or `CNAME`) alongside Jekyll, Astro, Docusaurus, and Hugo. For Pages it writes `seaworthy.config.json` (the baseline, plus `root` only when the marker sits in a `docs/` folder), `.github/workflows/seaworthy.yml` whose verify step is the bare `npx seaworthy verify`, and an empty `seaworthy-baseline.json`. It does not rewrite your Pages deploy job — add the verify step to it yourself, as above.
