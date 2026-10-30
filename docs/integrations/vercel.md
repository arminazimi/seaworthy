# Vercel

Verify the folder Vercel serves — the output directory — as the last step of the build command, so a broken site fails the deployment instead of going live. Seaworthy reads the built HTML and assets only; it never runs or imports your generator, and Vercel does the building.

## The output directory

Vercel builds the project and serves only the output directory. Set it in the dashboard under **Settings → Build & Development Settings → Output Directory**, or override it for a deployment with `outputDirectory` in `vercel.json`. The build command is the "Build Command" field, or `buildCommand` in `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

Point Seaworthy at that same output directory. Here it is `dist`; substitute whatever Vercel serves for your project.

## Add Seaworthy and run it after the build

`@seaworthy/verify` is not published yet (pre-alpha), so add it as a pinned git devDependency and commit the updated `package.json` and `package-lock.json`:

```bash
npm install --save-dev github:arminazimi/seaworthy#<commit>   # swap to the npm package once it is published
```

Vercel's install step installs `package.json` dependencies including devDependencies before the build runs, so Seaworthy is already available — you do not install it inside the build command. Append the verify step to the build command so a non-zero exit fails the deployment:

```json
{
  "buildCommand": "npm run build && npx seaworthy verify dist",
  "outputDirectory": "dist"
}
```

## Verify locally

Run the same command from a checkout before you deploy:

```bash
npx seaworthy verify dist
```

A `seaworthy.config.json` in the project root holds the folder and threshold so the build command stays short:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "dist",
  "failOn": "error"
}
```

## Exit codes and the deployment

`npx seaworthy verify dist` exits `0` when there are no findings at or above the failing severity, `1` when there are, `2` on a usage error, and `4` when a check or the engine crashes. With the `&&` chain, any non-zero exit fails the build command, which fails the deployment. `--fail-on` (`error` default, `warning`, `note`, or `none`) chooses the severity that stops it.

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

`site` is relative to your workspace and is the folder the build command above writes to; leave it empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default), `warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI built from the pinned commit, not a published package. This verifies in GitHub Actions regardless of where you deploy; Vercel stays the host.

## Notes

- **Headers and redirects.** Vercel declares headers and redirects in `vercel.json` (`headers` and `redirects`), and Seaworthy does not read that file. Its `hosting.headers` and `hosting.redirects` checks read the `_headers` and `_redirects` files of the Netlify and Cloudflare Pages format instead, so on Vercel they run only when your build actually emits those files in the output directory. If you keep your rules in `vercel.json`, those two checks verify nothing and there is no Seaworthy check for `vercel.json` — check them by hand.
- **Base path.** Seaworthy detects a deploy base path only from five generator configs — Jekyll, Astro, Docusaurus, Hugo, and VitePress — and reads no host config, so it does not learn a path from `vercel.json`. Vercel normally serves at the domain root, so this is usually `/`; if you deploy under a subpath, set `basePath` in `seaworthy.config.json` or pass `--base /path/`.
- **Folder discovery.** With no folder argument, Seaworthy verifies the first existing of `dist`, `build`, `out`, `public`, `_site`, `site`. If your output directory is not one of those, name it.
- Pin `<commit>` to a real SHA you chose; no release tag exists yet.
- Seaworthy reports and suggests; it never edits your files and never deploys.
