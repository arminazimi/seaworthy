# headings.order

Heading levels skip a level, such as an `h2` followed by an `h4`.

## Why it matters

Headings form an outline that screen readers navigate by level. A skipped level looks like missing content to someone who cannot see the layout.

## What it checks

Within a page, a heading may be at most one level deeper than the previous heading; going back up any number of levels is fine. Hidden headings are ignored.

## How to fix

```html
<h2>Install</h2>
<!-- before: jumps to h4 -->
<h4>Windows</h4>
<!-- after -->
<h3>Windows</h3>
```

Change the size with CSS, not by picking a different tag.

## Options

None.

## Standards

- [WCAG 1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
