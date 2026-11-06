## Goal
Crawl the home page and four inner pages of 100 popular Persian and Arabic sites, publish scores, the most common issues, and the method.

## Files

**Create**
- `bench/rtl-top100/README.md`
- `bench/rtl-top100/sites.json`
- `bench/rtl-top100/run.mjs`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Polite crawling (robots.txt, one request per second).
2. Publish aggregate results; no site is shamed in the headline.

## Done when
- [ ] The report and raw JSON are committed and reproducible with one command.
- [ ] `npm run check` passes.
