# names.link

A link has no text.

## Why it matters

A link with no text is announced as just "link". People who navigate by the list of links hear a column of identical entries.

## What it checks

An `<a href>` needs text, an image inside with non-empty `alt`, an SVG `<title>`, or an `aria-label` / `aria-labelledby` / `title`. Anchors without `href` and hidden links are skipped.

## How to fix

```html
<a href="/"><img src="/logo.svg" alt="Seaworthy home"></a>
```

Say where the link goes, not "click here".

## Options

None.

## Standards

- [WCAG 2.4.4 Link Purpose (In Context)](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html)
- [WCAG 4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)
