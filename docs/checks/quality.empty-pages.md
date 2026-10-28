# quality.empty-pages

A page whose HTML has no main text: away from the navigation, header, and footer, there is nothing to read.

## Why it matters

Agents, crawlers, and link previews read the HTML a build produced and do not run JavaScript. A page whose main content area is empty gives them nothing to answer with, link, or quote, however good it looks in a browser after scripts fill it in. Empty pages usually come from a build that skipped a page's content, a template left unimplemented, or a utility page that is only a frame with no body.

## What it checks

For every HTML page, the check takes the text a reader would see:

- in `<main>` (or the first element with `role="main"`) when there is one, and
- otherwise in `<body>`, minus the site frame: `nav`, `header`, `footer`, `aside`, their ARIA landmark roles, scripts, styles, and anything hidden with `hidden` or `aria-hidden="true"`.

A page is reported when that main text has **no words at all** (words of four or more letters or digits, the same measure the `readability.*` checks use). Short pages that have a few real words of their own — a note, a legal line, a label — pass; only pages with genuinely nothing fail. A page is also not reported when the container shows a picture, video, canvas, or embed instead of text, when it is a redirect page (`html.meta-refresh` is that page's check), or when its visible content is built in the browser (`readability.ssr-content` reports those shapes instead).

## How to fix

Put the page's content where readers and agents look for it — inside `<main>`, in the HTML the build serves:

```html
<!-- before: an empty content area with only chrome around it -->
<body>
  <header><nav><a href="/">Home</a> <a href="/about.html">About</a></nav></header>
  <main></main>
  <footer><p>© Example</p></footer>
</body>

<!-- after: the page's own content is in the HTML -->
<body>
  <header><nav><a href="/">Home</a> <a href="/about.html">About</a></nav></header>
  <main>
    <h1>Pricing</h1>
    <p>Plans start at $5 a month.</p>
  </main>
  <footer><p>© Example</p></footer>
</body>
```

Fix it in the source (the template or component that renders the page), not in the built file. If the page is empty to readers on purpose too, remove it from the build. Pages whose visible content only appears after JavaScript runs are a different problem — see `readability.ssr-content`.

## Options

None.

## Standards

None. The rule follows how agents consume pages: text in `<body>` that is not part of the site frame is the page's content, which is the same reading `<main>` and the article landmark encode in HTML.
