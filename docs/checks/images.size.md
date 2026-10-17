# images.size

An image file is larger than the size budget.

## Why it matters

Large images are the most common reason pages load slowly, especially on phones.

## What it checks

Each local image used by an `<img src>` is compared with the budget, 500 KB by default.

## How to fix

Resize the image to the largest size it is shown at, compress it, or serve a modern format such as WebP or AVIF.

## Options

- `maxBytes` (default `512000`): the largest allowed file size in bytes.

```json
{ "checks": { "images.size": { "options": { "maxBytes": 200000 } } } }
```

## Standards

None.
