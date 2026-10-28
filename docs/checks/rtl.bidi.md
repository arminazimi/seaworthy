# rtl.bidi

A page written in a right-to-left language does not declare or mirror its direction.

## Why it matters

Browsers start every page left to right unless `dir` says otherwise. A Persian page without `dir="rtl"` renders its text flushed left, its lists and tables mirrored the wrong way, and its punctuation stranded on the wrong side — even though everything else about the page looks correct. The same trap hides inside CSS: physical declarations such as `margin-left: 12px` keep the same physical edge when the layout mirrors, so the spacing lands on the side a reader does not expect. The logical equivalents (`margin-inline-start`) follow the text direction and stay correct on both directions.

## What it checks

For each page whose `lang` names an RTL language (Arabic, Hebrew, Persian, Urdu, and others) or whose declared direction is RTL:

- `<html>` has no `dir` attribute, so the browser starts the page left to right instead of right to left.
- Visible text mixes right-to-left and left-to-right characters while nothing scopes the direction (`dir` or `bdi`/`bdo`), so the embedded run can be reordered on the wrong side.
- A declaration fixes a physical side in this page's inline `<style>` or a stylesheet the page links: `margin-left`, `padding-right`, `border-*` side properties, or `text-align`/`float`/`clear` set to the physical `left`/`right` keyword.

The check is conservative: a declared `dir` — even `ltr` — is a deliberate choice, stylesheets that no RTL page links are out of scope, and look-alikes inside comments, strings, and selectors are skipped.

## How to fix

Declare the direction once and write the sides logically:

```html
<html lang="fa" dir="rtl">
```

```css
.card { margin-inline-start: 12px; text-align: start; }
```

Wrap an embedded left-to-right run — a name, an odometer, a code fragment — in `<bdi>…</bdi>` so the surrounding text cannot reorder it.

## Options

None.

## Standards

- [WCAG 3.1.2 Language of Parts](https://www.w3.org/WAI/WCAG22/understanding/language-of-parts.html)
