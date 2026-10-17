# meta.lang

The `<html>` element has no `lang` attribute, or an invalid one.

## Why it matters

Screen readers pick their voice and pronunciation from the page language; browsers use it for hyphenation, quotes, and translation offers. A French page read in an English voice is unusable.

## What it checks

`<html lang="...">` must be present and look like a language code: two or three letters, optionally followed by subtags (`en`, `fa`, `pt-BR`, `zh-Hant`). Redirect stubs are skipped.

## How to fix

```html
<html lang="fa" dir="rtl">
```

Set it once in the base layout. For a right-to-left language also set `dir="rtl"`.

## Options

None.

## Standards

- [WCAG 3.1.1 Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html)
