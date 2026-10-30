# Hugo

Seaworthy checks the HTML Hugo writes to `public/`. It reads that built folder only — it never runs Hugo or imports its config to render anything — so the recipe is: build with `hugo`, then verify `public`.

## Build the site

Install Hugo for your platform (see Hugo's own install docs), then create a site and build it. From the site folder:

```bash
hugo new site my-site
cd my-site
hugo            # writes the built site to public/
```

`hugo` writes to `public/` by default. Send it elsewhere with `hugo --destination <dir>`.

## Verify locally

`public` is one of the folders Seaworthy looks for when you name none — `dist`, `build`, `out`, `public`, `_site`, `site`, the first that exists — so point it at the folder to be unambiguous:

```bash
npx seaworthy verify public
```

> **Pre-alpha.** The `seaworthy` package is not on npm yet. In this repository `npx seaworthy` runs the workspace CLI after a build; in your own project install it from git, pinned to a commit — `npm install --save-dev github:arminazimi/seaworthy#<commit>` — and `npx seaworthy` finds it there.

### Base path

If the site is deployed at the domain root — Hugo's `baseURL = "https://example.com/"` — there is nothing to set: Seaworthy checks links and asset paths against `/`.

If it is deployed under a subpath — a GitHub project page at `https://user.github.io/repo/`, which Hugo builds from `baseURL = "https://user.github.io/repo/"` — Seaworthy reads `baseURL` from `hugo.toml` (or `hugo.yaml`, `hugo.yml`, `hugo.json`, `config.toml`, `config.yaml`) sitting next to `public/` or one folder up in the repo root, and checks against the path part (`/repo/`) on its own. The host is ignored; it is not visible in the built output.

To set the base path yourself instead of relying on detection:

```bash
npx seaworthy verify public --base /repo/
```

or in `seaworthy.config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "public",
  "basePath": "/repo/"
}
```

Precedence is `--base`, then `basePath` in the config, then the detected `baseURL`, then `/`. `root: "public"` is optional — it is already discovered — but set it, or the verify argument, when you build to a different folder.

Detection reads only a plain, top-level, quoted `baseURL`. If it is set twice, sits under a `[table]`, or is neither a URL path nor an `http(s)` URL, Seaworthy falls back to `/` and says why; set `basePath` or `--base` to fix it. A `--baseURL` passed on the `hugo` command line but not written to the config file is invisible to detection — put `baseURL` in the config or pass `--base`.

## In CI

This is the workflow `seaworthy init` writes when it detects Hugo (a `hugo.toml` or `config.toml` in the repo), with the pre-alpha install step added:

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
      - name: Install Seaworthy # pre-alpha: from git, pinned; swap to npm once it is published
        run: npm install --no-save github:arminazimi/seaworthy#<commit>
      - uses: peaceiris/actions-hugo@v3
        with:
          hugo-version: "latest" # pin a version here for reproducible builds
      - name: Build the site
        run: hugo
      - name: Verify
        run: npx seaworthy verify public
```

The `Verify` step follows the CLI's exit codes: `0` clean, `1` findings at or above the failing severity, `2` a usage error (a bad flag or config), `4` a crash. GitHub Actions fails the job on any non-zero exit, so a `1` — a real error-severity finding under the default `--fail-on error` — is the gate that blocks the merge. A `2` or `4` means the command or the engine broke, not the site; fix that before trusting a green run.

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

## Notes

- **Output folder.** Hugo's default is `public/`; `hugo --destination <dir>` changes it. Match it in `root` or the verify argument.
- **URL style.** Hugo decides whether a page lands at `/post/` or `/post.html` through `uglyURLs` and its `permalinks`. Seaworthy has no trailing-slash switch — it checks the files exactly as Hugo wrote them, so links and redirects resolve against the real output paths. Detection reads `baseURL` alone; `uglyURLs` does not move the base path.
- **Processed and hashed assets.** `resources.Get` with `.Fill`, `.Fingerprint`, or image processing writes generated files into `public/`. The checks read what is on disk, so a hashed asset URL is fine as long as the file exists in the output. Nothing to configure.
- **Adopting an existing site.** Run `npx seaworthy verify public --update-baseline seaworthy-baseline.json` once, commit the baseline, then verify against it so only new findings fail. See [Configuration](../configuration.md).
