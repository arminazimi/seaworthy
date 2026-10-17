# security.target-blank

An external link opens a new tab without `rel="noopener"`.

## Why it matters

Without `noopener`, older browsers give the opened page a handle (`window.opener`) to this one, which it can use to send the reader to a phishing page. Current browsers apply `noopener` by default, so this is a note.

## What it checks

`<a target="_blank">` with an external `href` (absolute or protocol-relative) needs `noopener` or `noreferrer` in `rel`. Links within the site are skipped.

## How to fix

```html
<a href="https://example.org" target="_blank" rel="noopener noreferrer">Example</a>
```

The report gives an exact edit that adds or extends `rel`.

## Options

None.

## Standards

None.
