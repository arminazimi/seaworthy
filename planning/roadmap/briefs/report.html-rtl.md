## Goal
Snippets in the HTML report keep their direction (isolated, with `dir` and `lang`) and use a font that covers Arabic script and Hebrew.

## Files

**Create**
- `packages/verify/tests/html-report-rtl.test.ts`

**Edit**
- `packages/verify/src/formats/html.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Wrap each snippet in `<bdi>` with the snippet's language.
2. Bundle no font; use a system stack that covers the scripts.

## Done when
- [ ] Screenshots of the report for each clean and broken RTL fixture are in the pull request.
- [ ] `npm run check` passes.
