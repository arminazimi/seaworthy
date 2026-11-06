## Goal
Accept a URL instead of a folder: fetch up to N pages (default 50) by following same-origin links and the sitemap, then run the same checks.

## Files

**Create**
- `packages/verify/src/crawl.ts`
- `packages/verify/tests/crawl.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Network only with a URL argument; respect `robots.txt`; one request at a time per host by default.
2. Store pages in a temp folder so every check works unchanged; locations name URLs.

## Done when
- [ ] Tests use a local HTTP server, never the internet.
- [ ] `npm run check` passes.
