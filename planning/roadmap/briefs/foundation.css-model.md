## Goal
Parse inline styles, `<style>`, and linked stylesheets into declarations with file, line, column, and the selectors they apply to, for every `rtl.css.*` check.

## Files

**Create**
- `packages/verify/src/rtl/css.ts`
- `packages/verify/tests/rtl-css-model.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Reuse the parsing now inside `checks/rtl.ts`; add `@font-face` and `unicode-range` parsing.
2. Cache per stylesheet; a stylesheet used by many pages is parsed once.

## Done when
- [ ] Tests cover shorthands, `!important`, media queries, and `@font-face`.
- [ ] `npm run check` passes.
