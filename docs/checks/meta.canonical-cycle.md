# meta.canonical-cycle

Pages' canonical links point at each other in a circle, so no page in the circle has a canonical URL.

## Why it matters

Canonical links form a chain: a duplicate points at the one real copy of the content, which points at itself. When two or more pages point at each other instead, the chain never ends, engines see conflicting advice on every page in the circle, and each page may stay in the index as its own address.

## What it checks

The canonical target of every page (only targets that are pages of the built site; `meta.canonical-target` covers the rest) is collected, and each chain is followed. A circle of two or more pages is reported, once per page in the circle, on that page's canonical link. A page whose canonical points at itself is the normal self-canonical and is not a circle.

## How to fix

```html
<!-- before: /one.html and /two.html point at each other -->
<!-- one.html -->
<link rel="canonical" href="https://example.com/two.html">
<!-- two.html -->
<link rel="canonical" href="https://example.com/one.html">
<!-- after: the duplicate points at the original, and the original at itself -->
<!-- one.html -->
<link rel="canonical" href="https://example.com/one.html">
<!-- two.html -->
<link rel="canonical" href="https://example.com/one.html">
```

Pick the one real address for the content, point every other page in the circle at it, and give the endpoint its own URL (or no canonical at all).

## Options

None.

## Standards

None.
