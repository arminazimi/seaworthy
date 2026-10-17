# names.button

A button has no accessible name.

## Why it matters

An icon-only button is announced as just "button", so people using a screen reader cannot tell what it does.

## What it checks

A `<button>` needs text, an `<img>` with `alt`, an SVG `<title>`, or an `aria-label` / `aria-labelledby` / `title`. `<input type="button">` needs a `value`, and `<input type="image">` needs `alt`. `submit` and `reset` inputs have a default name. Hidden buttons are skipped.

## How to fix

```html
<button aria-label="Close dialog"><svg aria-hidden="true">...</svg></button>
```

## Options

None.

## Standards

- [WCAG 4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)
