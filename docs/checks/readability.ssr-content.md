# readability.ssr-content

A page's HTML has almost no text and loads scripts, so its content probably only appears after JavaScript runs.

## Why it matters

Many agents, search crawlers, and link-preview bots read the HTML they download and do not run JavaScript. A page that ships `<div id="root"></div>` and builds everything in the browser looks empty to them, however good it looks to a person. That is the most common reason an AI tool "cannot see" a site that is plainly there. The fix is to put the content in the HTML when the site is built.

## What it checks

A page is reported when all of these hold:

- the readable text in `<body>` (scripts, styles, and `<noscript>` excluded) has fewer than 10 words of four or more letters or digits;
- the page loads at least one script (JSON data blocks such as JSON-LD are not scripts here); and
- one of: an application root (`#root`, `#app`, `#__next`, `#__nuxt`, `#svelte`, `#q-app`, `#outlet`, `#main-app`) with no text and no image or media inside; a `<noscript>` that tells people to enable JavaScript; or a body with nothing in it but scripts and metadata.

Short pages without scripts, pages with little text but real content such as an image, a canvas, or a note, and redirect pages are not reported. The check reads the built file and does not run it. It is a warning, never an error.

## How to fix

Render the content at build time. In most frameworks that means static site generation (Next.js `output: "export"`, Astro, Nuxt `generate`, SvelteKit `adapter-static` with prerendering, Vite with a prerender plugin) or server-side rendering. After the change, the built file contains the headings and paragraphs, and client code takes over afterward.

```html
<!-- before -->
<div id="root"></div>
<script type="module" src="/app.js"></script>

<!-- after -->
<div id="root"><main><h1>Pricing</h1><p>Plans start at $5 a month.</p></main></div>
<script type="module" src="/app.js"></script>
```

There is no automatic edit, because the fix is in how the site is built.

## Options

None.

## Standards

- [Agent-readability spec](../../spec/agent-readability/v1.md)
- [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) (background, not a standard)
