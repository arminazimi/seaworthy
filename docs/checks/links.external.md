# links.external

An external link no longer works. This check is off by default because it needs the network.

## Why it matters

Links to other sites rot. A broken external link wastes the reader's time and makes the page look abandoned.

## What it checks

Run with `--network` (or `"network": true`). Each distinct `http(s)` link in `<a>` and `<area>`, and each distinct `http(s)` link in the Markdown files found in the verified folder, is fetched once per run: `HEAD` first, then `GET` if the server refuses `HEAD`. At most 8 requests run at once and at most 2 per host. A URL that appears in both HTML and Markdown is still one fetch; each occurrence is reported where it was written, so Markdown findings are located at the link's line in the `.md` source.

- **404 and 410** are errors.
- **5xx** and **no answer** are warnings, because they are often temporary.
- **401, 403, 429, 999**, and responses protected by a bot filter (`cf-mitigated`) are skipped, not reported: Seaworthy cannot tell whether those links work.

Not yet implemented: an on-disk cache between runs.

## How to fix

Replace the link with its new address, link to an archived copy, or remove it. For links that are fine but cannot be checked, ignore them in config:

```json
{ "checks": { "links.external": { "options": { "ignore": ["^https://example\\.com/members/"] } } } }
```

## Options

- `timeoutMs` (default `10000`): how long to wait for an answer.
- `concurrency` (default `8`): requests at once.
- `ignore` (default `[]`): regular expressions; matching URLs are not checked.

## Standards

None.
