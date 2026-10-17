# robots.sitemap

A `Sitemap:` line in robots.txt is not an absolute URL, or points to a sitemap that is not in the build.

## Why it matters

Crawlers use the `Sitemap:` line to find the sitemap. A relative or broken address means they never do.

## What it checks

Each `Sitemap:` line must be an absolute `http(s)` URL, and its path must be served by the built site.

## How to fix

```text
Sitemap: https://example.com/sitemap.xml
```

## Options

None.

## Standards

- [RFC 9309 Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)
