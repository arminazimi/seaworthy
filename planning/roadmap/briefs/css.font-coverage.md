## Goal
Report RTL text whose `font-family` stack names no font that covers its script, using `@font-face` `unicode-range` and a list of common system fonts.

## Files

**Create**
- `packages/verify/src/checks/rtl-css-font-coverage.ts`
- `packages/verify/tests/rtl-css-font-coverage.test.ts`
- `docs/checks/rtl.css.font-coverage.md`
- `fixtures/broken/rtl-css-font-coverage/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.css.font-coverage` from `packages/verify/src/checks/rtl-css-font-coverage.ts`; the build discovers it, so edit no registry.
2. Generic families alone (`sans-serif`) count as a warning, not an error.
3. Fix hint: add a font that covers the script (for example Vazirmatn or Noto Sans Arabic).
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-css-font-coverage/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.css.font-coverage.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
