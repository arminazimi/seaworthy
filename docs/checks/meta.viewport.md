# meta.viewport

A page has no viewport meta tag, or one that stops people from zooming.

## Why it matters

Without a viewport tag phones render the page as a zoomed-out desktop layout. Blocking zoom makes the page unusable for people with low vision.

## What it checks

- A `<meta name="viewport">` must exist.
- Its content must not contain `user-scalable=no` (or `0`), and `maximum-scale` must be at least 2.

## How to fix

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

## Options

None.

## Standards

- [WCAG 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
