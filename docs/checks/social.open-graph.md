# social.open-graph

A page is missing Open Graph tags, so shared links look bare.

## Why it matters

Chat apps, social networks, and search assistants build link previews from `og:title`, `og:description`, and `og:image`. Without them they guess, and often show nothing.

## What it checks

Each page needs non-empty `og:title`, `og:description`, and `og:image`. A page with none is a **note**; a page with some but not all is a **warning**, because the preview is inconsistent.

## How to fix

```html
<meta property="og:title" content="Install the CLI">
<meta property="og:description" content="One command to check your site.">
<meta property="og:image" content="https://example.com/img/card.png">
```

## Options

None.

## Standards

None.
