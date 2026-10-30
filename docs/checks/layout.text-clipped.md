# layout.text-clipped

Text whose rendered box is smaller than the text inside it is cut off, with no way for anyone to reach what is lost.

## Why it matters

A fixed-height card, a title that is not allowed to wrap, a button whose width was chosen for the word
"Save" and now carries "Submit your application": in each case the browser lays out more words than the
box can show, the box hides the excess, and the reader gets half a sentence. Nothing in the markup looks
wrong — the text is there, and an agent reading the HTML reads all of it — so the page disagrees with
whatever it rendered, and the difference is invisible to whoever has to live with it. People who zoom,
who use a phone, or who read a language that needs more room than English are the first to lose words
this way, and they cannot scroll to them: the container swallows them.

## What it checks

The check renders each page in a real browser, at the three widths every rendered check uses — phone
(375 px), tablet (768 px) and desktop (1280 px) — and measures the box that holds the text rather than
judging the markup:

- For each box whose computed `overflow-x` or `overflow-y` is `hidden` or `clip`, `scrollWidth` against
  `clientWidth` and `scrollHeight` against `clientHeight`. A box that hides what does not fit and does
  not fit itself is a candidate.
- That what does not fit is **text**. The browser's layout of the text inside the box is measured with
  range rectangles and compared with the box's client box (its padding edge, so a border does not hide
  the answer). A thumbnail box that crops a wide photograph cuts no words, so it is not reported.
- The finding names the clipped element by its CSS selector and its own markup, says which axis is cut
  and how many CSS px of text sit outside the box, and names the widths it was cut at. One clipped box
  is one finding, not one per width; a box cut off on both axes gets one finding per axis.

**What it refuses to decide.** Everything below is deliberately silent, because reporting it would be a
design choice Seaworthy guesses at rather than a defect it can see:

- `overflow: visible`, and `auto` or `scroll` on the axis that spills. A region with a scrollbar keeps
  its content reachable, so it is not this check's problem whatever its size.
- An ellipsis the author asked for: `text-overflow` that is not `clip` on a box whose line cannot wrap
  (`white-space: nowrap` or `pre`) or on a `-webkit-line-clamp` box. A card title that ends in "…" is
  deliberate. `text-overflow: ellipsis` that cannot render — a multi-line box with no clamp — is not an
  ellipsis, and the cut inside it is still reported.
- The page itself: `html` and `body` are never the clipped element. See the boundary below.
- A box with nothing to show: `clientWidth` or `clientHeight` at 0. A panel collapsed to `height: 0` with
  `overflow: hidden` is an accordion someone opens, and this check cannot tell that from a mistake.
- Text the browser does not lay out as HTML: inline SVG `<text>`, shadow DOM and iframe content are not
  walked, and a box's `visibility: hidden` or `display: none` content is not measured.
- Cuts of 1 CSS px or less are treated as rounding: `scrollWidth` and `clientWidth` are whole numbers.

**The boundary with its siblings.** The unit of reporting here is the clipped element. A page that
scrolls sideways at a phone width is `layout.horizontal-overflow`'s finding, and content that does not
reflow at 320 CSS px is `layout.reflow`'s; neither of those is a finding here, even when the page's own
box is what fails to fit. Conversely, a box inside the page that hides its own text is this finding and
not theirs. The `html` and `body` exclusion is what keeps one problem one finding, and it is tested both
offline and against a page that only scrolls sideways.

**Limits of the measurement.** It is taken once, after the page's `load` event, from a `file://` URL, with
requests to remote `http(s)` resources aborted so the run stays offline. Two consequences are honest to
state rather than hide: a page whose `@font-face` points at a CDN is measured with the local fallback
face, so its text can come out a few CSS px narrower or wider than in production; and a box whose text
position is animated or moved by script after load is measured in whatever state it happens to be in.
Suppress such a finding with a `<!-- seaworthy-ignore layout.text-clipped: reason -->` comment next to the
markup, or in `seaworthy.config.json`, rather than loosening the check for the whole site.

This check needs a browser and is opt-in: it runs only under `--rendered` (see [ADR 0005](../adr/0005-headless-browser.md)),
skips with a reason and a hint when the machine has no browser, and has no broken fixture in the fixture
gate for the same reason — a fixture that only passes when a browser is present proves nothing.

## How to fix

Change the stylesheet the site builds from, not this built file. The finding names the box and the axis.

```css
/* before: a card with a height picked in a design tool; the third line is never seen */
.card { height: 88px; overflow: hidden; }
/* after: the box grows with its text, and keeps the design's minimum */
.card { min-height: 88px; }
```

```css
/* before: a title that may not wrap, cut mid-word at the box edge */
.title { white-space: nowrap; overflow: hidden; }
/* after: either let it wrap … */
.title { overflow-wrap: anywhere; }
/* … or truncate on purpose, so the reader knows text is missing */
.title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

```css
/* before: a button sized for a shorter label */
button { width: 70px; overflow: hidden; }
/* after: the label decides the width, and the long label still reads */
button { min-width: 70px; width: auto; }
```

Where a long text genuinely belongs in a fixed box — a log pane, a table cell with its own scroll — make
it reachable rather than hidden:

```css
.log { height: 240px; overflow-y: auto; }
```

## Options

`checks."layout.text-clipped".options.minPixels` — the least number of CSS px of text outside the box
before it is reported. Default 3; whole numbers of at least 0 are accepted and anything else falls back to
the default. The value is applied twice on purpose: to the text measured outside the box and to the box's
own `scroll` minus `client`. A value below 2 finds nothing extra, because the browser probe itself ignores
boxes cut by 1 CSS px or less as measurement noise.

```json
{
  "checks": {
    "layout.text-clipped": { "options": { "minPixels": 8 } }
  }
}
```

Like every check, it also takes `off`, `severity` and `maxFindings`. The check is off unless the run asks
for rendered checks with `--rendered`.

## Standards

- [WCAG 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) — claimed for the
  phone-width findings: text that a fixed box cuts off at 375 px is text the page does not reflow, and
  content that needs two-dimensional scrolling to be read is what 1.4.10 exists to stop. A box clipped
  identically at 1280 px is not a 1.4.10 failure and the finding does not claim to be one; it is the same
  defect measured at a width where it also shows.
- [WCAG 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) — a box whose
  size is fixed in CSS px stops growing when people enlarge text, so the text grows out of it.
- [CSS Overflow Level 3](https://drafts.csswg.org/css-overflow-3/) — `overflow`, the `scroll`/`client`
  metrics and `text-overflow`, which is where the measurement comes from.

A finding is a measurement of a rendered page, not a conformance verdict: it says words are cut off with
no way to reach them, and leaves whether that fails a criterion to the site's own assessment.
