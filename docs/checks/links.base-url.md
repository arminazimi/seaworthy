# links.base-url

Links do not match the base path the site is deployed under.

## Why it matters

A site built for `https://user.github.io/repo/` but with links that start at `/` (or the reverse) works on a developer's machine and breaks when deployed: every stylesheet and link 404s. It is the most common GitHub Pages mistake.

## What it checks

- **With `basePath` set** (for example `"/repo/"` in `seaworthy.config.json`): a root-absolute link such as `/about.html` that does not start with the base path leaves the site, and is reported with the fixed address.
- **Without `basePath`**: if several root-absolute links start with the same first segment (`/repo/…`), do not resolve, but do resolve once that segment is removed, the site was probably built for a sub-path. One finding explains it and shows both ways out.

Links starting with `//` and external links are ignored.

## How to fix

If the site is deployed under `/repo/`, tell Seaworthy:

```json
{ "basePath": "/repo/" }
```

and make every root-absolute link start with `/repo/` (most generators have a `base` or `baseurl` setting for this). If it is deployed at the domain root, remove the `/repo/` prefix from the links.

## Options

None.

## Standards

None.
