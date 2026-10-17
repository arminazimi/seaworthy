# images.dimensions

An image has no `width` and `height`, so the page jumps as it loads.

## Why it matters

The browser cannot reserve space for an image whose size it does not know, so text moves when the image arrives. That layout shift is annoying and counts against the page's performance score.

## What it checks

Every `<img>` needs positive `width` and `height` attributes. Images sized with inline `style` (both properties, or `aspect-ratio`) and `data:` URIs are skipped.

For local images the report reads the file's real size (PNG, GIF, JPEG, WebP) and proposes the exact attributes; if only one attribute is present, the other is computed from the image's proportions.

## How to fix

```html
<img src="/hero.jpg" alt="..." width="1200" height="630">
```

CSS can still scale the image; the attributes only tell the browser its proportions.

## Options

None.

## Standards

None.
