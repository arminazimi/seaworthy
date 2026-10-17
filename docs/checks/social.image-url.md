# social.image-url

A social preview image is not an absolute HTTPS URL.

## Why it matters

The sites that build link previews fetch the image themselves, so a relative path means nothing to them, and many refuse plain HTTP.

## What it checks

`og:image` and `twitter:image` must start with `https://`.

## How to fix

```html
<!-- before -->
<meta property="og:image" content="/img/card.png">
<!-- after -->
<meta property="og:image" content="https://example.com/img/card.png">
```

## Options

None.

## Standards

None.
