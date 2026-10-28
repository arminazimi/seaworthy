# hosting.headers

The `_headers` file of Netlify or Cloudflare Pages has a malformed line, or it sets headers on a path the built site does not serve.

## Why it matters

Both hosts read `_headers` at the top of the build output, line by line, and silently skip anything they cannot parse. One malformed line quietly drops the header it was meant to set, for example a `Content-Security-Policy`, and a path that matches no file does nothing. The site ships looking correct while the protection or cache rule never applies.

## What it checks

- Every non-blank, non-comment (`#`) line is either a URL path (one line) or a header like `X-Frame-Options: DENY` on the lines below it, indented or flat, the way both hosts accept.
- A path starts with `/` (or is `*`), and its splat and placeholders are placed where the hosts match them: a placeholder directly after the `/`, never a splat and a placeholder in one segment.
- A path with no splat and no placeholder names a page or file the build actually serves.
- Header field names use valid characters (RFC 7230).

## How to fix

Point the path at a page the build emits, or build the page it applies to. Rewrite malformed lines the way the hosts document:

```text
# before: a header with no colon is ignored
/*
  X-Frame-Options DENY

# after
/*
  X-Frame-Options: DENY
```

Change the source that produces the built `_headers` file, not just the build output.

## Options

None.

## Standards

- [Netlify: custom headers](https://docs.netlify.com/manage/routing/headers/)
- [Cloudflare Pages: headers](https://developers.cloudflare.com/pages/configuration/headers/)
