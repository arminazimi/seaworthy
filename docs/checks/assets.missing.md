# assets.missing

A page loads a file (image, script, stylesheet, media) that is not in the built site.

## Why it matters

A missing stylesheet or script breaks the page's look or behavior; a missing image leaves a hole and an empty `alt` read aloud. These often only break after a build step moves or renames files, which is exactly when nobody is looking.

## What it checks

The check looks at the files a page loads: `img` and `source` (`src` and every `srcset` candidate), `script`, `link` for stylesheets, icons, manifests and preloads, `video` (`src` and `poster`), `audio`, `track`, `embed`, `object`, `iframe`, and `input type=image`. Each local URL must resolve to a file in the built site. `data:` URIs, remote URLs, and `<link rel=canonical>` style links that load nothing are skipped.

## How to fix

```html
<!-- before: the image is logo.png -->
<img src="/img/logo.pn" alt="Logo">
<!-- after -->
<img src="/img/logo.png" alt="Logo">
```

The report suggests the closest file with the same extension. If the file should exist, fix the build so it is copied; if it was removed on purpose, remove the reference in the source.

## Options

None.

## Standards

None.
