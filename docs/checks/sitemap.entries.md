# sitemap.entries

The sitemap lists a page that is not in the built site, or an entry that is not an absolute URL.

## Why it matters

Search engines read the sitemap to find pages. Entries that 404 waste their crawl budget and make the whole file less trusted, and relative entries are invalid.

## What it checks

Starting from `/sitemap.xml`, the check reads every `<loc>`. Each must be an absolute `http(s)` URL whose path is served by the built site (the configured `basePath` is honored). Sitemap indexes are followed into the sitemaps they list that exist in the build. A `/sitemap.xml` without a `<urlset>` or `<sitemapindex>` root is reported. XML entities such as `&amp;` are decoded.

## How to fix

Regenerate the sitemap from the pages that really exist (most generators have a plugin for it), or remove the stale entries. Write full URLs:

```xml
<url><loc>https://example.com/docs/guide.html</loc></url>
```

## Options

None.

## Standards

- [Sitemaps protocol](https://www.sitemaps.org/protocol.html)
