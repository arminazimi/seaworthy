# images.alt

An image has no `alt` attribute.

## Why it matters

Without `alt`, a screen reader reads out the file name ("IMG underscore 4032 dot jpg"). People who cannot see the image get nothing, and search engines cannot index what it shows.

## What it checks

Every `<img>` needs an `alt` attribute. An empty `alt=""` is correct for purely decorative images. Images with `role="presentation"` or `role="none"`, `aria-hidden="true"`, or an `aria-label` / `aria-labelledby` are not reported.

## How to fix

```html
<!-- informative image: say what it shows -->
<img src="/chart.png" alt="Signups doubled between March and June">
<!-- decorative image: empty alt -->
<img src="/divider.png" alt="">
```

The report offers an edit that adds a placeholder `alt`; **replace the placeholder with real text**. Describe what the image conveys in context, not what it looks like.

## Options

None.

## Standards

- [WCAG 1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)
