# Nuxt: static generation

`nuxt generate` pre-renders your routes and writes a plain static site to `.output/public`, and Seaworthy verifies that folder. Seaworthy reads built output only — it never runs Nuxt and never reads `nuxt.config.ts` — so this recipe ends at the build.

## Build the site

```bash
npm create nuxt@latest my-site   # skip if you already have a project
cd my-site
npm ci
npx nuxt generate                # pre-renders the routes into .output/public
```

`nuxt generate` is `nuxt build` with prerendering turned on — Nuxt documents it as triggering the build with the `prerender` argument set to `true` — and `nuxt build --prerender` is the same build. Nuxt's own examples also run it through the project's `generate` script. Either way the pre-rendered HTML lands in `.output/public`.

`.output` holds two builds, and only one of them is a static site:

- `.output/public` — the pre-rendered HTML, the client bundles under `_nuxt/`, and everything copied from `public/`. This is the folder to verify.
- `.output/server` — the Node server bundle a normal `nuxt build` writes. It renders pages when a request asks for them, so no page exists there as a file: a server-rendered deployment has no static folder for Seaworthy to verify, and pointing it at `.output/server` checks a server bundle, not a site.

The same goes for a `nuxt build` that prerenders nothing: `.output/public` then carries client assets and no pre-rendered pages, so there is no site in it to check.

## Verify locally

```bash
npx seaworthy verify .output/public
```

> **Pre-alpha.** The `seaworthy` package is not on npm yet. In this repository `npx seaworthy` runs the workspace CLI after a build; in your own project install it from git, pinned to a commit — `npm install --save-dev github:arminazimi/seaworthy#<commit>`, the form [docs/consumers/theme.md](../consumers/theme.md) documents — and `npx seaworthy` finds it there.

Name the folder every time. Given no folder, Seaworthy takes the first of `dist`, `build`, `out`, `public`, `_site`, `site` that exists in the folder it runs from — and a Nuxt project keeps a `public/` folder of *source* assets, so a bare `verify` at the project root would check unbuilt files instead of the site. `.output` is none of the names it tries. If you move the output somewhere else (Nitro's `output` option; its documented example is `dist`, and `dist` is the first name discovery tries), believe the path your own build printed and name that folder.

### Base path

A site deployed at the domain root needs nothing: Seaworthy resolves root-absolute links and asset paths against `/`.

A site deployed under a subpath — a GitHub project page at `https://user.github.io/repo/` — is built with `app.baseURL`, which Nuxt documents as the base path of the application:

```ts
export default defineNuxtConfig({
  app: {
    baseURL: '/repo/',
  },
})
```

Every URL the build emits then starts with `/repo/`, while the files stay at their unprefixed paths inside `.output/public`. Seaworthy does not read `nuxt.config.ts` — its base-path detection covers Jekyll, Astro, Docusaurus, Hugo, and VitePress configs only, and Nuxt is not one of them. Say the same value yourself, in `seaworthy.config.json` at the project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": ".output/public",
  "basePath": "/repo/"
}
```

Or for a single run:

```bash
npx seaworthy verify .output/public --base /repo/
```

Precedence is `--base`, then `basePath` in the config, then `/`. Write the value the way Nuxt writes it — `/repo/`, with both slashes — and Seaworthy canonicalizes `repo`, `/repo` and `/repo/` to the same thing. With the base path missing or wrong, [links.base-url](../checks/links.base-url.md) and [links.internal](../checks/links.internal.md) treat every root-absolute link as leaving the site.

Nuxt also documents building with `NUXT_APP_BASE_URL=./ npm run generate` for relative asset paths. Then the emitted hrefs are page-relative, there is no base path to declare, and Seaworthy resolves each one against the file it sits in.

## In CI

One job builds the static site, then verifies it:

```yaml
name: Verify site
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npx nuxt generate              # pre-renders into .output/public
      - name: Install Seaworthy # pre-alpha: from git, pinned; swap to npm once it is published
        run: npm install --no-save github:arminazimi/seaworthy#<commit>
      - name: Verify
        run: npx seaworthy verify .output/public
```

The install step comes after `npm ci` on purpose: `npm ci` deletes `node_modules` and would wipe a `--no-save` install made before it. If you add Seaworthy to the project's `package.json` as a pinned git devDependency instead, `npm ci` installs it and the extra step goes away.

The `Verify` step is the gate, and it follows the CLI's exit codes: `0` when nothing reaches the failing severity (`error` by default), `1` when a finding does, `2` a usage error such as a bad flag or config, `4` a check or engine crash. GitHub Actions fails a step on any non-zero exit, so `1` is the one that blocks a merge on a real finding; a `2` or `4` means the command or the run broke, not the site, and a green run proves nothing until it is gone.

## Or run it as an Action

The repository also ships a composite GitHub Action (`action.yml`). It installs and builds the CLI inside its own checkout, verifies one folder, optionally writes a SARIF 2.1.0 report, and fails the run at the threshold — so it replaces the install-and-verify steps above:

```yaml
      - name: Verify with Seaworthy
        uses: arminazimi/seaworthy@<commit> # no release tag is cut yet: pin a commit
        with:
          site: .output/public
          threshold: error
          sarif: seaworthy.sarif
```

`site` is relative to your workspace and is the folder the build command above writes to; leave it empty to let the CLI pick the first build folder it finds. `threshold` accepts `error` (the default), `warning`, `note`, or `none`. `sarif` is optional — when set, the report is written there and uploaded as a workflow artifact. Same pre-alpha caveat as everywhere else on this page: the Action runs the CLI built from the pinned commit, not a published package.

## Notes

- **What pages exist at all.** Nuxt prerenders `/`, every route in `prerender.routes` (top level in `nuxt.config.ts`, or `nitro.prerender.routes`), and, on `nuxt generate`, whatever the crawler reaches from the `<a href>` links in the HTML it has already written; Nitro's own `prerender.crawlLinks` default is `false`, so read the route list the build prints rather than assuming a page is in it. A page linked from nowhere needs a route entry or a `prerender: true` route rule. A route that was never prerendered is simply absent, and [links.internal](../checks/links.internal.md) then reports every link to it as a missing page — an error, so it fails the run. It reads like a broken link, so fix it in the build config, not in the page.
- **A route that fails to prerender is skipped.** Nitro documents `failOnError` as `false` by default: the build succeeds with the page missing. Set `nitro: { prerender: { failOnError: true } }` in CI so the build fails where the page is missing, instead of Seaworthy finding out afterwards.
- **URL shape.** `autoSubfolderIndex` (Nitro's default, `true`) writes `/about` as `.output/public/about/index.html`; with `false` it is `about.html`. Seaworthy resolves both forms — a directory URL to an `index.html`, an extensionless URL to the `.html` or to the directory index — so the switch changes the file paths in findings, not what passes.
- **Hashed client bundles.** The chunks under `_nuxt/` (the folder `app.buildAssetsDir` names) are content-hashed and are real files in the output. The checks read the folder on disk, so a hashed URL resolves exactly like an unhashed one; nothing to configure. `app.cdnURL` is different: it points the asset URLs at another host, and offline checks treat those as external and skip them, so they cannot confirm the files exist.
- **`public/` is copied unmodified** to the top of `.output/public`, which is where Nuxt puts files that must keep their names. That makes it the place for a host's `_headers` and `_redirects`: [hosting.headers](../checks/hosting.headers.md) and [hosting.redirects](../checks/hosting.redirects.md) read `/_headers` and `/_redirects` at the top of the folder you verify, and report nothing when the files are absent. Nuxt's own redirects (`routeRules` with `redirect`) are server behaviour, not files in the output — on a static host, do redirects at the host.
- **The fallback pages.** `nuxt generate` writes `200.html` and `404.html`, and Nuxt documents that both are empty shells by default. [quality.not-found-page](../checks/quality.not-found-page.md) reports a 404 page that renders no visible text; set `experimental.prerenderErrorPages` so Nuxt server-renders your `error.vue` into `404.html` at build time, or give the page real content. [quality.orphans](../checks/quality.orphans.md) reports `200.html`, because nothing links to it and it is neither an index nor the 404 page; when you keep the shell on purpose, `"ignore": ["200.html"]` in the config, or a suppression with a reason, keeps it visible instead of silent.
- **`ssr: false`.** Nuxt documents prerendering with SSR switched off, and says what it costs: each page ships an empty `<div id="__nuxt"></div>` and scripts, which is exactly the shape [readability.ssr-content](../checks/readability.ssr-content.md) reports as content that only appears after JavaScript runs. Keep `ssr` at its default for `nuxt generate` and wrap the parts that cannot be server-rendered in `<ClientOnly>`, as Nuxt suggests.
- **Payload files.** Prerendered routes also emit `_payload.json` beside the HTML: the data Nuxt reuses during client-side navigation. No page links to them, so the link and asset checks find no target to resolve there — they are just more files in the folder.
- **Findings name built paths.** A location is a file under `.output/public` — generated HTML, not the `.vue` source that produced it. Fix the source, run `npx nuxt generate`, verify again.
- **`seaworthy init` does not detect Nuxt.** Its markers are the Jekyll, Astro, Docusaurus, Hugo, and GitHub Pages files, so in a Nuxt project init writes a config with no `root`, an empty baseline, and a workflow with no build step. Add `root: ".output/public"` and your generate step, or skip init and write the config shown above.
- **Adopting an existing site.** Run `npx seaworthy verify .output/public --update-baseline seaworthy-baseline.json` once, commit the baseline, then verify with `--baseline seaworthy-baseline.json` so only new findings fail. See [Configuration](../configuration.md).
