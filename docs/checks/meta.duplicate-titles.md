# meta.duplicate-titles

The same `<title>` text appears on two or more pages.

## Why it matters

The title names a page in browser tabs, bookmarks, search results, and screen reader announcements. When several pages share one title, an agent or a person returning to the site cannot tell them apart: the tab says "Documentation" three times, and search engines pick one page instead of each page ranking for what it is about.

## What it checks

The check groups pages across the whole site by their collapsed `<title>` text and reports one finding per text that appears on more than one page, listing the affected pages. Comparisons are case-sensitive and done after collapsing runs of whitespace. Pages with no `<title>` or an empty one are skipped (meta.title reports those), and pages that only redirect (`<meta http-equiv="refresh">`) are skipped.

## How to fix

Before — every page of the site emits the same title:

```html
<head>
  <title>My Site</title>
</head>
```

After — each page names itself, usually through the template that produces it:

```html
<head>
  <title>Install the CLI | My Site</title>
</head>
```

Set the title in the layout or front matter of the source that produces the page. A title that repeats everywhere often means the layout is ignoring the page's own name.

## Options

None.

## Standards

None. This is an information-quality check, not a conformance rule.
