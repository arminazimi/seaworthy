# meta.canonical

A page has no canonical link, or its canonical link is not an absolute URL.

## Why it matters

The canonical link tells search engines which address to list when a page is reachable at several (with and without `index.html`, with tracking parameters). Relative canonical links are ignored by search engines.

## What it checks

Each page should have `<link rel="canonical" href="https://...">`. A missing one is a note; one that is empty or not an absolute `http(s)` URL is a warning.

## How to fix

```html
<link rel="canonical" href="https://example.com/docs/guide.html">
```

Most generators can emit it from the site's public URL setting.

## Options

None.

## Standards

None.
