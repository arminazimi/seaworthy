# social.twitter-card

A page has no usable Twitter card, so a link to it gets a bare or default preview on X.

## Why it matters

X uses `twitter:card` to choose the preview layout. Without a valid card type it falls back to the default summary card, and other `twitter:*` tags on the page do nothing. A post that could show a wide image instead shows a small text link, which gets fewer clicks.

## What it checks

Every page except redirect stubs (`html.meta-refresh`) needs `<meta name="twitter:card" content="...">` with one of `summary`, `summary_large_image`, `app`, or `player`.

- **No card** (note): the page has no `twitter:card`.
- **Orphaned Twitter tags** (warning): the page has other `twitter:*` tags but no `twitter:card`, so they are ignored.
- **Unknown card type** (warning): the value is not one of the four known types.
- **No image** (warning): a `summary` or `summary_large_image` card has neither `twitter:image` nor `og:image` to fall back to.

`twitter:title` and `twitter:description` are not required, because X falls back to `og:title` and `og:description`.

## How to fix

```html
<!-- before -->
<meta property="og:title" content="Install the CLI">
<meta property="og:description" content="One command to check your site.">
<meta property="og:image" content="https://example.com/card.png">

<!-- after -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://example.com/card.png">
```

Use `summary_large_image` for a wide preview and `summary` for a small square one. Add `twitter:title` or `twitter:description` only when they should differ from the Open Graph values.

## Options

None.

## Standards

- [X Cards markup](https://developer.x.com/en/docs/x-for-websites/cards/overview/markup)
- [Open Graph protocol](https://ogp.me/) (the fallback tags)
