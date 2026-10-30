# Netlify

Verify the folder Netlify serves — the publish directory — as the last step of the build command, so a broken site fails the deploy instead of going live. Seaworthy reads the built HTML and assets only; it never runs or imports your generator, and Netlify does the building.

## The publish directory

Netlify builds the site and serves only the publish directory. Set it in `netlify.toml` under `[build]`, or with the "Publish directory" field in the site's build settings:

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

Point Seaworthy at that same `publish` folder. Here it is `dist`.

## Add Seaworthy and run it after the build

`@seaworthy/verify` is not published yet (pre-alpha), so add it to your project as a pinned git devDependency and commit the updated `package.json` and `package-lock.json`:

```bash
npm install --save-dev github:arminazimi/seaworthy#<commit>   # swap to the npm package once it is published
```

Netlify installs project dependencies before it runs the build command, so Seaworthy is already present — you do not install it inside the build command. Append the verify step to the build command so a non-zero exit fails the deploy:

```toml
[build]
  command = "npm run build && npx seaworthy verify dist"
  publish = "dist"
```

## Verify locally

Run the same command from a checkout before you deploy:

```bash
npx seaworthy verify dist
```

A `seaworthy.config.json` next to `netlify.toml` holds the folder and threshold so the CI line stays bare:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "dist",
  "failOn": "error"
}
```

## Exit codes and the deploy

`npx seaworthy verify dist` exits `0` when there are no findings at or above the failing severity, `1` when there are, `2` on a usage error, and `4` when a check or the engine crashes. With the `&&` chain, any non-zero exit fails the build command, which fails the deploy. Set `--fail-on` (`error` default, `warning`, `note`, or `none`) to choose the severity that stops a deploy.

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

`site` is relative to your workspace and is the folder the build command above writes to; leave it empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default), `warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI built from the pinned commit, not a published package. This verifies in GitHub Actions regardless of where you deploy; Netlify stays the host.

## Notes

- **`_headers` and `_redirects`.** Netlify serves custom headers and redirects from `_headers` and `_redirects` files in the publish directory. Seaworthy's `hosting.headers` and `hosting.redirects` checks read exactly those files in the folder you verify, flagging malformed lines and paths the build does not actually serve. Verify the publish directory (here `dist`) and they are covered; Seaworthy does not edit them.
- **Base path.** Seaworthy detects a deploy base path only from five generator configs — Jekyll, Astro, Docusaurus, Hugo, and VitePress — and reads no host config, so it does not learn a path from `netlify.toml`. Netlify normally serves at the domain root, so this is usually `/`; if you deploy under a subpath, set `basePath` in `seaworthy.config.json` or pass `--base /path/`.
- **Folder discovery.** With no folder argument, Seaworthy verifies the first existing of `dist`, `build`, `out`, `public`, `_site`, `site`. If your publish directory is not one of those, name it.
- Pin `<commit>` to a real SHA you chose; no release tag exists yet.
- Seaworthy reports and suggests; it never edits your files and never deploys.
