# meta.title

A page has no `<title>`, or an empty one.

## Why it matters

The title is what a browser tab, a search result, a bookmark, and a screen reader announce first. A page without one shows its URL instead.

## What it checks

Every page needs a non-empty `<title>`. Redirect stubs (`html.meta-refresh`) are skipped.

## How to fix

```html
<head>
  <title>Install the CLI | Seaworthy</title>
</head>
```

Put the page's own name first, then the site name. Set it in the layout or front matter that produces the page.

## Options

None.

## Standards

- [WCAG 2.4.2 Page Titled](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html)
