## Goal
Report `line-height` below 1.5 (or fixed lengths that compute below it) on Arabic-script and Urdu text, where diacritics and Nastaliq glyphs get clipped.

## Files

**Create**
- `packages/verify/src/checks/rtl-css-line-height.ts`
- `packages/verify/tests/rtl-css-line-height.test.ts`
- `docs/checks/rtl.css.line-height.md`
- `fixtures/broken/rtl-css-line-height/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.css.line-height` from `packages/verify/src/checks/rtl-css-line-height.ts`; the build discovers it, so edit no registry.
2. Urdu threshold 1.8.
3. Fix hint: raise `line-height` for `:lang(fa)`, `:lang(ar)`, and `:lang(ur)`.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-css-line-height/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.css.line-height.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
