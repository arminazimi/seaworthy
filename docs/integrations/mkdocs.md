# MkDocs

MkDocs (and the Material theme) builds your Markdown docs into the static folder `site`, and Seaworthy verifies that built output: it reads the HTML and assets in `site` and never runs or imports MkDocs itself.

## Build the site

Seaworthy checks built output only, so build first, from the folder that holds `mkdocs.yml`:

```bash
python -m pip install mkdocs            # or: python -m pip install -r requirements.txt
python -m mkdocs build --strict         # writes the site to ./site
```

`--strict` makes MkDocs fail the build on its own warnings, so you fix them before Seaworthy sees the site. The output folder is `site` by default; if your `mkdocs.yml` sets `site_dir`, use that folder name below.

## Verify locally

> **Pre-alpha.** `seaworthy` is not on npm yet. To run the CLI today, install it from this repository pinned to a commit (as [the theme guide](../consumers/theme.md) does), then run `seaworthy`. The commands below assume that CLI is on your `PATH`.

The default output folder `site` is the last one Seaworthy tries when you give no folder (it checks `dist`, `build`, `out`, `public`, `_site`, then `site`), so name the folder to avoid picking up an unrelated build directory:

```bash
npx seaworthy verify site
```

Docs published under a subfolder — a project page at `https://host/repo/docs/`, say — need their base path. Seaworthy reads base paths from some generator configs, but **MkDocs is not one of them**; it never reads `mkdocs.yml` or `site_url`. Tell Seaworthy the base path so the checks resolve `/docs/...` links and asset paths against it, with `basePath` in `seaworthy.config.json` in the folder you run from, or `--base /docs/` for a single run:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "site",
  "basePath": "/docs/"
}
```

## In CI

One job that builds the docs and then verifies them. `verify` exits `1` when it finds problems at or above the failing severity (default `error`), which fails the step and the job; a clean run exits `0`. An exit `2` is a usage error and `4` means a check crashed — both fail the job too.

```yaml
name: Verify docs
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -m pip install -r requirements.txt   # includes mkdocs
      - run: python -m mkdocs build --strict
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npx seaworthy verify site --format json
```

Add `--base /docs/` to that last line when the docs deploy under a subfolder and you would rather not keep it in the config file.

## Or run it as an Action

The repository also ships a composite GitHub Action (`action.yml`). It installs and builds the CLI inside its own checkout, verifies one folder, optionally writes a SARIF 2.1.0 report, and fails the run at the threshold — so it replaces the install-and-verify steps above:

```yaml
      - name: Verify with Seaworthy
        uses: arminazimi/seaworthy@<commit> # no release tag is cut yet: pin a commit
        with:
          site: site
          threshold: error
          sarif: seaworthy.sarif
```

`site` is relative to your workspace and is the folder the build command above writes to; leave it empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default), `warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI built from the pinned commit, not a published package.

## Notes

- **`site_dir`.** The folder MkDocs writes to; `site` unless `mkdocs.yml` overrides it. Whatever it is, pass that name to `verify`.
- **`use_directory_urls`.** Default `true` builds each page to `page/index.html` with links ending in `/`; `false` builds flat `page.html`. Seaworthy reads whichever the build wrote, so keep this setting the same between your build and how the site is actually served — the internal-link check resolves the built HTML exactly as written.
- **Base path.** Set `basePath` or `--base` for a subfolder deploy. Seaworthy does not detect it from `mkdocs.yml`, so the `site_url` in that file changes nothing Seaworthy sees on its own.
- **Unhashed assets.** MkDocs copies assets under `assets/` without a content hash in the filename, so the paths in the built HTML are the paths on disk. Nothing extra to configure.
- **`_headers` / `_redirects`.** MkDocs does not generate these hosting files; if you add them yourself so they land in `site`, they are checked like any other built file, otherwise there is nothing to check.
