# names.label

A form field has no label.

## Why it matters

A field without a label is announced as just "edit text", so people using a screen reader or voice control cannot tell what to enter. A placeholder disappears when typing starts and is not a label.

## What it checks

Every `input` (except `hidden`, `submit`, `button`, `reset`, `image`), `select`, and `textarea` needs a name from one of: a `<label for>` matching its `id`, a wrapping `<label>`, `aria-label`, `aria-labelledby` pointing at an element that exists, or `title`. Hidden fields are skipped.

## How to fix

```html
<label for="email">Email</label>
<input type="email" id="email">
```

Prefer a visible label. Use `aria-label` only when the design has no room for one.

## Options

None.

## Standards

- [WCAG 1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
- [WCAG 3.3.2 Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)
- [WCAG 4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)
