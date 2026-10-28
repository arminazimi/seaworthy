# quality.orphans

A page of the built site that no other page links to.

## Why it matters

Every page should be reachable by following links from a page people already land on. When nothing links to a page, navigation never shows it, agents that crawl or read the site never find it, and analytics show no internal traffic. Orphans are usually drafts that were never linked, pages left behind by a redesign, or pages whose links disappeared when the linking page changed. A person landing on the page by chance also has nowhere it is linked from.

## What it checks

The check builds the link graph of the built site from every `<a href>` and `<area href>` (resolved the way a static host serves URLs, including relative paths, extensionless URLs, directory URLs, and the configured `basePath`) and reports every page that no other page links to. A broken link—the link points to a page that does not exist—counts for nothing. A link from a page to itself (for example `#top`) does not make the page reachable.

Pages that are reachable without an inbound link are never reported:

- index pages (`index.html`, including the home page), which serve their directory URL whether or not anything links to it;
- the 404 page (`/404.html`), which static hosts serve for every missing URL without any link;
- pages listed in `sitemap.xml`, and in the sitemaps a sitemap index lists, because they are published on purpose and findable from there.

## How to fix

Link to the page from a place readers already see:

```html
<!-- before: nobody links to /draft.html -->
<!-- after: a section index links to it -->
<a href="/draft.html">Draft review checklist</a>
```

Fix it in the source (the Markdown or template that renders the links), not in the built file. If the page is no longer needed, delete it from the build and from the sitemap. If the page really is meant to stand alone, list it in `sitemap.xml` so crawlers can find it; the check then accepts it.

## Options

None.

## Standards

None.
