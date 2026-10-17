# robots.blocks-all

robots.txt tells every crawler not to visit anything.

## Why it matters

`User-agent: *` with `Disallow: /` keeps the whole site out of search results. It is a common leftover from a staging site that was copied to production.

## What it checks

In robots.txt, a group for `User-agent: *` that contains `Disallow: /` and no `Allow` rule is reported. Groups for specific crawlers are not.

## How to fix

Remove `Disallow: /`, unless the site is meant to be private:

```text
User-agent: *
Allow: /
```

## Options

None.

## Standards

- [RFC 9309 Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)
