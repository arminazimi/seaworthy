# suppress.invalid

A `seaworthy-ignore` comment is malformed, so it suppresses nothing.

## Why it matters

A suppression that silently does nothing is worse than none: the person who wrote it believes a problem is handled, and it is not.

## What it checks

Every `<!-- seaworthy-ignore ... -->` comment in the built HTML must name one or more known check IDs, a colon, a reason of at least 3 characters, and optionally `until YYYY-MM-DD` with a real date. Prefix patterns such as `a11y.*` are allowed.

## How to fix

```html
<!-- seaworthy-ignore images.alt: decorative sprite, tracked in #123 until 2027-03-01 -->
```

Common mistakes: no reason, no colon, a misspelled check ID, or a date that does not exist.

## Options

None.

## Standards

None.
