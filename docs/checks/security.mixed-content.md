# security.mixed-content

A page loads a resource over plain HTTP.

## Why it matters

On an HTTPS page, browsers block plain-HTTP scripts, stylesheets, and frames, and warn about images, so the page breaks or looks insecure. Anyone on the network path can also change those files.

## What it checks

Resources loaded by `img` and `source` (`src` and every `srcset` candidate), `script`, `iframe`, `video`, `audio`, `embed`, `object`, `track`, `link` for stylesheets, icons, and preloads, and `form action` must not use `http://`. Plain-HTTP navigation links (`<a href>`) and `localhost` addresses are not mixed content and are skipped.

## How to fix

```html
<!-- before -->
<script src="http://cdn.example.com/app.js"></script>
<!-- after -->
<script src="https://cdn.example.com/app.js"></script>
```

The report suggests the `https://` address; check that the server really supports HTTPS before applying it.

## Options

None.

## Standards

- [Mixed content (W3C)](https://www.w3.org/TR/mixed-content/)
