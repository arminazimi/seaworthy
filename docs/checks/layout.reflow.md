# layout.reflow

Rendered at a 320 CSS px viewport, the page must fit a single column: this check reports the fixed-size box that keeps the document wider than 320 px, so the reader has to pan sideways as well as scroll.

## Why it matters

A person using a phone, a narrow window, or 200% zoom sees the page through roughly 320 CSS px of width. WCAG 1.4.10 Reflow (Level A) accepts two shapes there: a single column that reflows to fit, or content that is legitimately two-dimensional as part of the content itself — a map, a game, a table or spreadsheet presented as such. When a page forces the *document* to pan in both dimensions because nothing shrinks, reading becomes two-handed work: lines run off screen, focus rings and controls hide beyond the right edge, and a screen-reader user's sighted partner cannot follow along.

## What it checks

The page is opened in a headless browser at exactly 320 CSS px wide — the width the success criterion fixes, which is narrower than the shared phone viewport (375 px), so this check carries its own documented constant rather than measuring where the failure would hide. A finding is raised per page where the document itself must be panned horizontally and at least one box stays wider than the viewport instead of shrinking. The finding names the *outermost* such box with its CSS selector, opening markup and measured width, so the author can tell which fixed size to change; inner wide boxes are the same problem and are not repeated. One problem, one finding: `layout.horizontal-overflow` reports the document scrolling sideways at a phone width (a long unbreakable word pans the page without any fixed-size box — that symptom is its finding, not this one's), and `layout.text-clipped` reports an element whose own text is cut off (content absorbed by an overflow clip never pans the document, so it is not reported here); this check reports only the page-level reflow failure under 1.4.10 and the fixed-width element that causes it.

The exceptions this check implements are the success criterion's own, and exactly these:

- **Tabular data.** A `<table>` wider than the viewport passes, and so does every box inside one, because the criterion exempts content "presented in two dimensions" when that is essential to the information.
- **Content in its own scroll container.** A box whose overflow is absorbed by a non-root ancestor with `overflow-x` other than `visible` (auto, scroll, hidden, clip) passes: the document reflows around it, and the two-dimensional part scrolls by itself — this is how a map or a game earns the exception.

The author's intent behind a wide box cannot be told from markup, so two things are deliberately *not* exempted: images, videos and iframes that simply keep an intrinsic or attribute width (they should scale; wrap an essential-detail map in a scroll container instead), and scrolling on `html`/`body` itself (the document is then the scroller, which is the failure, not the exception). The criterion's 256 CSS px height is not measured: a page that pans sideways fails whatever its height is.

This check needs a browser and is opt-in: it runs only under `--rendered` (see [ADR 0005](../adr/0005-headless-browser.md)). Pages load from `file://` URLs, requests to remote `http(s)` resources are aborted, site contents are laid out by the browser and never evaluated as instructions, and shadow DOM is not traversed. There is no broken fixture for it in the fixture gate for the same reason.

## How to fix

Let the element fit the narrow viewport; `max-width: 100%` with `width: auto` is the usual shape:

```css
/* before: nothing shrinks below 600 px, so the document pans */
.banner { width: 600px; }
/* after: the block reflows into the single column */
.banner { max-width: 100%; }
```

For an image, the same rule on the replaced element: `img { max-width: 100%; height: auto; }`. For genuinely two-dimensional content, keep the wide box but give it its own scroll container, which is what the check honours as the exception:

```html
<div style="overflow-x: auto">
  <table>…600 px wide…</table>
</div>
```

## Options

None.

## Standards

- [WCAG 1.4.10 Reflow (Level A)](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
