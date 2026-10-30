# SvelteKit with the static adapter

`@sveltejs/adapter-static` writes your prerendered SvelteKit pages to `build`, and Seaworthy verifies that folder: one report with every broken link, missing alt text, and wrong base path in the HTML you actually ship. Seaworthy reads built output only — it never runs Vite or SvelteKit, and it does not read `svelte.config.js`.

> **Status: pre-alpha.** `@seaworthy/verify` is not published, so a bare `npx seaworthy` does not resolve yet. Run the CLI from a checkout of this repository (`npm ci && npm run build`, then `node packages/verify/dist/src/cli.js`), or install it from a pinned git commit the way the CI job below does.

## Build the site to `build`

Install the adapter as a devDependency **in your own project**. It is your site's dependency, never this repository's:

```bash
npm install --save-dev @sveltejs/adapter-static
```

Point `kit.adapter` at it and prerender everything, in `svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build', // where prerendered pages are written (the adapter's default)
      assets: 'build', // where static assets are written; ordinarily the same folder
      // fallback: '200.html', // only for a client-side-only SPA — see Notes
    }),
    prerender: {
      default: true, // prerender every route instead of opting in page by page
      entries: ['*'], // the SvelteKit default: every route with no required [parameters]
    },
  },
};

export default config;
```

Then build:

```bash
npm run build # vite build; the adapter writes build/
```

If the project has no `build` script, add `"build": "vite build"` to its `package.json`.

Prerendering is what makes this path verifiable: a route that was not written to disk is a route the checks cannot see. With `default: true`, every route without required parameters is prerendered, and SvelteKit follows `<a href>` links from those entries (`crawl: true`, also the default) to reach the rest. A parameterised route such as `src/routes/blog/[slug]/+page.svelte` is only on disk when its concrete URLs are either linked from a prerendered page or listed in `entries`; SvelteKit's build log names the routes it prerenders as it goes.

## Verify locally

From the project folder, right after the build:

```bash
node packages/verify/dist/src/cli.js verify build # from a Seaworthy checkout, pre-alpha
npx seaworthy verify build # once the package is published
```

`build` is one of the folders the CLI picks up when you name none — it tries `dist`, `build`, `out`, `public`, `_site`, `site` in that order — but it is second in that list, so a stray `dist` in the project wins. Name the folder anyway.

A site deployed at a domain root needs no config file. Deployed under a sub-path, it needs one; see the first note below.

## In CI

One job that builds the site and then verifies it:

```yaml
name: Verify the built site
on: pull_request
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install the site
        run: npm ci
      - name: Build the site
        run: npm run build
      - name: Install Seaworthy # pre-alpha: from git, pinned; swap to npm once it is published
        run: npm install --no-save github:arminazimi/seaworthy#<commit>
      - name: Verify the build folder
        run: npx seaworthy verify build --fail-on error
```

Keep the Seaworthy install step **after** `npm ci`: `npm ci` deletes `node_modules` and would wipe a `--no-save` install placed before it. If you would rather pin it properly, add the same git reference to your own `package.json` devDependencies — then `npm ci` installs it and the extra step goes away.

The verify step is the gate, and it fails the job on any non-zero exit: `0` means no findings at or above `--fail-on` (whose default is `error`), `1` means findings at or above it, `2` is a usage error such as a typo'd flag, and `4` means a check or the engine crashed.

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

## Notes

- **Base path: Seaworthy does not read `svelte.config.js`.** Base-path detection covers the Jekyll, Astro, Docusaurus, Hugo, and VitePress config files and nothing else, so `kit.paths.base` stays invisible to it. When you deploy to a sub-path, say `/docs`, pass the same value yourself — `"basePath": "/docs"` in `seaworthy.config.json`, or `--base /docs` — because without it the engine verifies against `/` while every link in the build carries `/docs`, and `links.base-url` is left guessing the prefix back from the links that do not resolve. SvelteKit requires `paths.base` to start with `/` and not end with it; Seaworthy accepts `/docs` and `/docs/` alike and normalizes both to `/docs/`.
- **`seaworthy init` does not detect SvelteKit.** It recognizes Astro, Docusaurus, Hugo, Jekyll, and GitHub Pages markers only. Write the config and the workflow by hand, as above.
- **A `fallback` page means almost no HTML to check.** With `fallback: '200.html'` you get one app shell plus the `_app/` chunks, and the checks only ever see what is on disk. That has consequences worth knowing before you choose it: `links.internal` reports a link to a route nothing on disk serves, because on disk nothing serves it, and `readability.ssr-content` warns on a page whose app root (it looks for `#svelte` among others) is empty and which loads scripts. Both are honest readings of an SPA-only build. Prerender the routes you link to and keep the fallback for the stragglers; SvelteKit's docs name `200.html` rather than `index.html` so the fallback never shadows a prerendered home page.
- **`strict` is SvelteKit's own guard for this.** `strict` (on by default) makes adapter-static check that the pages and endpoints it expected were prerendered and fail the build when they were not; SvelteKit's docs describe setting it to `false` as the way to accept a build that ships fewer files. A clean `npm run build` is therefore a good sign `build/` holds every page the report will talk about.
- **Hashed `_app/` chunks are not a problem.** `assets.missing` asks only whether a URL a page references exists in the folder, so immutable files under `_app/` with content hashes in their names verify exactly like stable ones. Nothing in Seaworthy guesses a file name.
- **`static/` is copied verbatim, and that is where host files belong.** SvelteKit copies the contents of `static/` into the output folder unchanged, so a `_headers` or `_redirects` you keep there lands at the top of `build/` — which is precisely where `hosting.headers` and `hosting.redirects` read them, as `/_headers` and `/_redirects`. Their rules are Netlify's and Cloudflare Pages', so check the syntax against those hosts.
- **URL style does not confuse the link checks.** Whether a route is served as `/about/`, `/about`, or `/about.html`, `links.internal` resolves a directory URL to its `index.html` and an extensionless URL to its `.html` the way a static host serves URLs.
- **Findings name the built HTML; fix the `.svelte` source.** `images.alt`, `headings.h1`, `headings.order`, and `meta.title` point at `build/index.html` and its siblings, because that is what was checked. Editing build output is lost on the next build; change the component or the Markdown that rendered it.
- **Browser and network checks stay opt-in.** Everything above runs offline against files. `--rendered` turns on the checks that need a browser (`"rendered": true` in the config) and `--network` the ones that make requests (`"network": true`); both are off by default.
