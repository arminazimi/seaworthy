# Docusaurus

Docusaurus builds a docs site to `build/` at the project root; Seaworthy verifies that built folder and returns one report of what an agent should fix. Seaworthy reads the built output only — it never imports or runs Docusaurus, and this repository ships no Docusaurus code and adds no dependency.

## Install

Seaworthy is pre-alpha: `npx seaworthy` is not published to npm yet. Add it to your Docusaurus project as a devDependency pinned to a commit of this repo, and the `seaworthy` command becomes available through `npx`:

```bash
npm install --save-dev github:arminazimi/seaworthy#<commit>
```

Move to the npm package when it is published.

## Build, then verify

Docusaurus writes the site to `build/` (the default `outDir`):

```bash
npm run build      # docusaurus build, writes build/
npx seaworthy verify build
```

`build` is also one of the folders Seaworthy tries on its own when you run it with no argument, so `npx seaworthy verify` works from the project root once the site is built. Name `build` explicitly anyway — it says which folder the report is about.

### Base path

A docs site served under a project path sets `baseUrl` in `docusaurus.config.js` (for example `'/docs-site/'`). Seaworthy reads that `baseUrl` straight from your `docusaurus.config.js` (`.js`, `.mjs`, or `.ts`) when it is next to the built folder or in the project root, so you normally set nothing. To pin it yourself, or when the config sits where Seaworthy cannot find it, add `seaworthy.config.json` in the folder you run the CLI from:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "build",
  "basePath": "/docs-site/",
  "failOn": "error"
}
```

`--base /docs-site/` overrides the same value for a single run. The base path is what `links.base-url` and the internal-link checks compare the built links against, so getting it right is the one setting most docs sites need.

## Verify on every build (plugin snippet)

Docusaurus has a real post-build hook, so the verify can run in the same process that finished the build — no separate command, and the build fails the moment Seaworthy finds a problem. This is a snippet you keep in **your own project**; this repository neither ships nor tests it, and it adds no dependency (it only shells out to the CLI you already installed).

Save it as `plugin/seaworthy.js`:

```js
// Runs `seaworthy verify` on the folder Docusaurus just wrote. Fails the build on findings.
const { spawnSync } = require("node:child_process");

module.exports = function seaworthyPlugin(context, options) {
  return {
    name: "docusaurus-plugin-seaworthy",
    async postBuild({ outDir }) {
      const args = ["seaworthy", "verify", outDir];
      if (options && options.failOn) args.push("--fail-on", options.failOn);
      const run = spawnSync("npx", args, { cwd: context.siteDir, stdio: "inherit" });
      if (run.status !== 0) {
        throw new Error(`seaworthy verify exited with code ${run.status}`);
      }
    },
  };
};
```

Register it in `docusaurus.config.js`:

```js
module.exports = {
  // baseUrl, themeConfig, presets, …
  plugins: [["./plugin/seaworthy", { failOn: "error" }]],
};
```

`postBuild` receives `outDir`, the same folder `npm run build` wrote, so `npm run build` now builds and verifies in one step. If you would rather not add a plugin, chain the CLI in the build script instead — `docusaurus build && seaworthy verify build` — which the plugin exists to replace.

## In CI

One job that builds then verifies. This is the plain-CLI version; if you use the plugin above, drop the last step because `npm run build` already verifies.

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
          npm run build
      - name: Verify
        run: npx seaworthy verify build
```

The verify step uses the CLI's exit-code contract: `0` when nothing reaches the threshold, `1` when there are findings at or above `--fail-on` (default `error`), `2` for a usage error, and `4` when a check crashes. Any non-zero exit fails the job, so it is the `1` — your site's findings — that turns the check red.

## Or run it as an Action

The repository also ships a composite GitHub Action (`action.yml`). It installs and builds the CLI inside its own checkout, verifies one folder, optionally writes a SARIF 2.1.0 report, and fails the run at the threshold — so it replaces the install-and-verify steps above:

```yaml
      - name: Verify with Seaworthy
        uses: arminazimi/seaworthy@<commit> # no release tag is cut yet: pin a commit
        with:
          site: build
          threshold: error
          sarif: seaworthy.sarif
```

`site` is relative to your workspace and is the folder the build command above writes to; leave it empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default), `warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI built from the pinned commit, not a published package.

## Notes for Docusaurus

- **`baseUrl` is the setting that changes the checks.** Seaworthy reads it from your `docusaurus.config.js`; a wrong base path makes internal links and asset paths look broken. `--base` or `basePath` in the config override it.
- **`trailingSlash`.** Docusaurus's `trailingSlash` setting (`'never'` or `'always'`) decides whether pages and links end in `/`. Seaworthy checks the links exactly as they appear in the built HTML — it has no trailing-slash option of its own — so keep your own links consistent with the value you set.
- **`url` must be set for the sitemap.** Docusaurus only writes `build/sitemap.xml` when `url` is configured; with no `url` there is no sitemap for the sitemap checks to read.
- **Hashed bundles are fine.** The JS and CSS under `build/assets/` carry content hashes; Seaworthy reads built HTML and the assets it references and never needs the generator, so hashing changes nothing.
- **Real HTML per page.** Docusaurus prerenders every route, so the default checks read page content directly. The checks that need a browser or the network stay off; turn them on in `seaworthy.config.json` with `"rendered": true` or `"network": true`, never by default.
