# social.image-size

A social preview image is too small to fill the card, or too heavy for the platform to accept.

## Why it matters

Each platform crops or rejects a preview image that does not fit its card. A wide image is what makes a shared link stand out; an image below the minimum is shown small or not at all, and one above the size cap is dropped, leaving a bare link.

## What it checks

For every page except redirect stubs (`html.meta-refresh`), Seaworthy reads the local image named by `og:image` and, depending on the card type, `twitter:image`. Absolute URLs are matched to built files only when they share the page's origin, taken from `og:url` or the canonical link; images on other origins are skipped, because checks do not use the network.

| Tag | Minimum | Recommended |
|---|---|---|
| `og:image` | 600 × 315 | 1200 × 630 |
| `twitter:image` with `summary_large_image` | 300 × 157 | 1200 × 628 |
| `twitter:image` with `summary` | 144 × 144 | — |

Images larger than 5 MB are reported too; X rejects them. A file whose format or header cannot be read is skipped rather than guessed at.

## How to fix

Replace the file the tag points at with one of at least the recommended size, or point the tag at a larger copy:

```html
<!-- before: a 400×200 crop -->
<meta property="og:image" content="https://example.com/img/thumb.png">

<!-- after -->
<meta property="og:image" content="https://example.com/img/card.png">
```

```html
<!-- before: a 6 MB PNG -->
<meta name="twitter:image" content="https://example.com/img/card.png">

<!-- after: the same picture as a compressed WebP or JPEG -->
<meta name="twitter:image" content="https://example.com/img/card.webp">
```

Keep the image's important content near the center: platforms crop the sides of a wide card to fit their own aspect ratio.

## Options

None.

## Standards

- [Open Graph protocol](https://ogp.me/)
- [X Cards markup](https://developer.x.com/en/docs/x-for-websites/cards/overview/markup)
- [Facebook link preview image guidance](https://developers.facebook.com/docs/sharing/best-practices#images)
