# Jekyll

Seaworthy verifies the built site Jekyll writes to `_site/`, so the recipe is: build with Jekyll, then run `seaworthy verify _site` on the folder it wrote. `_site` is one of the folders the CLI already discovers (`dist`, `build`, `out`, `public`, `_site`, `site`), so a bare `seaworthy verify` finds it too when nothing earlier in that list exists. Seaworthy never runs Jekyll: it reads the built output only.

## Build the site

```bash
gem install jekyll
jekyll build          # writes _site/
```

For a GitHub Pages site, build with the same gem bundle Pages would use:

```bash
bundle add github-pages
bundle exec jekyll build
```

## Verify locally

The CLI is pre-alpha: `@seaworthy/verify` is not published to npm yet, so run it from a checkout of this repository.

```bash
# once, in a folder next to your site
git clone https://github.com/arminazimi/seaworthy.git ../seaworthy
cd ../seaworthy && npm ci && npm run build && cd -

# in your Jekyll project folder, after the build
node ../seaworthy/packages/verify/dist/src/cli.js verify _site
```

Seaworthy works with no config. Add `seaworthy.config.json` in the project folder (the folder you run verify from) when the site is deployed under a base path, as project pages are:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "_site",
  "basePath": "/my-site/"
}
```

`basePath` is the deploy path, such as `/repo/` for `https://user.github.io/repo/`; the `links.base-url` check uses it to tell whether the built links match. See [Configuration](../configuration.md) for every key.

## In CI

One job builds the site and then verifies it:

```yaml
name: verify
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.2"
          bundler-cache: true
      - name: Build the site
        run: bundle exec jekyll build
      - name: Check out the Seaworthy CLI
        uses: actions/checkout@v4
        with:
          repository: arminazimi/seaworthy
          path: .seaworthy-cli
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Build the CLI
        run: cd .seaworthy-cli && npm ci && npm run build
      - name: Verify
        run: node .seaworthy-cli/packages/verify/dist/src/cli.js verify _site
```

The Verify step fails the job with exit code 1 when the site has a finding at or above `--fail-on` (default `error`); set `failOn` in the config or pass `--fail-on` to change the bar. Exit 2 (usage error) and exit 4 (a check crashed) also stop the run; exit 0 means the site passed.

Adopting an existing site with findings: record today's results once and commit the file, and later runs fail only on new findings:

```bash
node ../seaworthy/packages/verify/dist/src/cli.js verify _site --update-baseline seaworthy-baseline.json
node ../seaworthy/packages/verify/dist/src/cli.js verify _site --baseline seaworthy-baseline.json
```

## Notes for Jekyll

- **Folder discovery.** With no `dir` argument and no `root` in the config, the CLI takes the first of `dist`, `build`, `out`, `public`, `_site`, `site` that exists. A project that also has a `public/` or `dist/` folder is verified from that one instead, so pass `_site` explicitly (or set `root`) in those projects.
- **`baseurl` in `_config.yml`.** When `_site` sits inside the project folder, Seaworthy reads the `baseurl` from the neighbouring `_config.yml` on its own. An explicit `basePath` in the config, or `--base /my-site/` for one run, overrides detection; when the value is ambiguous the site is checked against `/` and the report says why.
- **`trailing_slash` and permalinks.** Jekyll's `trailing_slash` setting and custom `permalink` styles change which files land in `_site` (`about/index.html` versus `about.html`). Checks only ever see the built files, so verify the same `_site` you deploy, and rebuild before verifying after any permalink change.
- **`include:` and underscore files.** Jekyll keeps top-level names starting with `_` out of `_site` unless they are listed in `include:`. If the site serves `_headers` or `_redirects` for Netlify or Cloudflare Pages, add them to `include:` — the `hosting.headers` and `hosting.redirects` checks read the files from the built output, so an excluded copy has nothing to check.
- **Assets are copied as-is.** Plain Jekyll renames or processes nothing in `assets/`, so a reference to `{{ "/img/logo.png" | relative_url }}` points at exactly that file in `_site`; `assets.missing` reports the page when it is not there. An asset pipeline plugin that fingerprints names changes what the build writes, and the checks follow the output.
- **Adoption shortcut.** `seaworthy init` detects Jekyll from `_config.yml` and writes the config with `root: "_site"`, a CI workflow, and an empty baseline in one step; until the npm package is published, edit the workflow's verify step to the source-built command above.
