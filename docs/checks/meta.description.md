# meta.description

A page has no meta description, or an empty one.

## Why it matters

Search results and link previews use the description as the page's summary. Without one, engines pick arbitrary text from the page.

## What it checks

Every page needs `<meta name="description" content="...">` with some text. Redirect stubs (`html.meta-refresh`) are skipped.

## How to fix

```html
<meta name="description" content="Check any built static site and get a report an agent can act on.">
```

Write one sentence per page; do not reuse the same text everywhere.

## Options

None.

## Standards

None.
