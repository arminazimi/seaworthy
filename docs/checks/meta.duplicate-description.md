# meta.duplicate-description

Several pages carry the exact same meta description.

## Why it matters

Search results and link previews show the per-page description as the page's summary. When every page has the same text, engines pick the same summary everywhere — the site looks like one page repeated, and no page gets an accurate preview.

## What it checks

Pages that have the same `<meta name="description">` text after whitespace is collapsed. The pages are grouped, and one finding names the description and every page that shares it. Single occurrences, empty descriptions, and redirect stubs are skipped (those belong to `meta.description`).

## How to fix

Give each page a description that says what that page is about:

```html
<!-- before: on every page -->
<meta name="description" content="The official site.">

<!-- after -->
<meta name="description" content="How to install the CLI and verify a built site in one command.">
```

## Options

None.

## Standards

None.
