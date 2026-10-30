# Next.js: static export

A Next.js project built with `output: 'export'` writes a complete static site to `out/` at the project root, and Seaworthy verifies that folder like any other built output. Seaworthy reads the built files only; it never runs Next.

## Build the export

Create or enter the project:

```bash
npx create-next-app@latest my-site   # skip if you already have a project
cd my-site
```

Set the export in `next.config.js` (or `next.config.mjs`):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

module.exports = nextConfig;
```

`images.unoptimized` (or a custom `images.loaderFile`) is what makes `next/image` usable in a static export: the default optimizer is a Next server route, and an export has no server. Then build:

```bash
npm run build   # next build; the static site lands in out/
```

The server build folder `.next/` is not the site — verify `out/`, not `.next/`. On Next 13.2 and older the same output came from `next build && next export`; `output: 'export'` replaced that command in 13.3, and `next export` no longer exists from Next 14 on.

## Verify locally

From the project root, name the folder explicitly:

```bash
seaworthy verify out
```

Name it even though `out` is in the default search (Seaworthy tries `dist`, `build`, `out`, `public`, `_site`, `site`, in that order): a Next project usually has a source folder named `public/`, so on an unbuilt checkout the default search can verify raw source assets instead of the site.

`seaworthy` is not on npm yet — the CLI is pre-alpha, built from this repository. From a checkout of it, run `npm ci && npm run build` and use the built CLI, e.g. `node packages/verify/dist/src/cli.js verify out`.

A deployment under a sub-path — a GitHub project page — needs one extra step. Next builds those links with the `basePath` setting in `next.config.js`, and Seaworthy does not read Next's config: its base-path detection covers Jekyll, Astro, Docusaurus, Hugo, and VitePress only. Say the base path yourself, in `seaworthy.config.json` in the project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  "root": "out",
  "basePath": "/my-site/"
}
```

Set `basePath` exactly as `next.config.js` sets it, or pass `--base /my-site/` for a one-off run. With the base path wrong or missing, [links.base-url](../checks/links.base-url.md) and the internal-link check see every root-absolute link as leaving the site.

## In CI

One job builds the export, then verifies it. The Seaworthy packages are not on npm yet, so the workflow checks out this repository at a pinned commit and runs the CLI from that build — the same shape as [docs/badge.md](../badge.md):

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
          node-version: 22
      - run: npm ci
      - run: npm run build                    # next build; writes out/
      - uses: actions/checkout@v4
        with:
          repository: arminazimi/seaworthy
          ref: <TRUSTED-SHA>                  # a full commit SHA of main you trust
          path: .seaworthy-tool
          persist-credentials: false
      - run: npm ci && npm run build
        working-directory: .seaworthy-tool
      - run: node .seaworthy-tool/node_modules/@seaworthy/verify/dist/src/cli.js verify out
```

The `verify` step is the gate: it exits 0 when nothing reaches `--fail-on` (default `error`) and exits 1 when something does — exit 1 with findings is what fails the job on a broken site. A usage error exits 2 and a check or engine crash exits 4; those fail the job too, and they mean the run itself was broken, not the site. Do not add `continue-on-error` to the verify step.

## Notes for Next.js

- `trailingSlash` changes the shape of `out/`: with `trailingSlash: true` the export writes `about/index.html` and links `/about/`; the default writes `about.html` and links `/about`. [links.internal](../checks/links.internal.md) resolves both forms, so pass and fail do not change; the file paths in findings do.
- With `images.unoptimized: true`, exported HTML points at the real files under `out/` (copies of `public/` are served unhashed, exactly as written), and the asset checks resolve them. With a custom loader, every image URL points at another host, which offline checks skip — they never see those files.
- `assetPrefix` turns asset URLs into absolute URLs to a CDN; the checks treat them as remote and skip them, so prefix only what you host elsewhere.
- `redirects()` and `rewrites()` in `next.config.js` are not compatible with `output: 'export'` — the build refuses them. Do redirects at your host. If you copy Netlify or Cloudflare Pages `_headers` and `_redirects` files into `out/` after the build, [hosting.headers](../checks/hosting.headers.md) and [hosting.redirects](../checks/hosting.redirects.md) read them; when neither file exists, nothing is reported.
- Findings point inside the built folder — a location under `out/` names the generated page, not the file in `app/` or `pages/` that produced it. Fix the source, rebuild, verify again.
