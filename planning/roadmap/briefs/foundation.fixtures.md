## Goal
Four small, correct right-to-left sites that every check must report nothing on: the guard against false positives.

## Files

**Create**
- `fixtures/clean/rtl-fa/`
- `fixtures/clean/rtl-ar/`
- `fixtures/clean/rtl-he/`
- `fixtures/clean/rtl-ur/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Each site: 4 to 6 pages with headings, paragraphs mixing Latin words, numbers, URLs, code, forms, tables, lists, and a stylesheet using logical properties.
2. Correct typography for each language (ZWNJ and Persian digits in Persian; Arabic punctuation; gershayim in Hebrew; Urdu letters and a Nastaliq-capable font stack).
3. Each has `expected.json` with no findings.

## Done when
- [ ] A native reader of each language reviewed its fixture (name them in the pull request).
- [ ] Every built-in check reports nothing on the four sites.
- [ ] `npm run check` passes.
