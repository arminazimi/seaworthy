## Goal
Report `text-align`, `float`, `clear`, and `resize` values `left` and `right` in styles that apply to RTL pages.

## Files

**Create**
- `packages/verify/src/checks/rtl-css-physical-values.ts`
- `packages/verify/tests/rtl-css-physical-values.test.ts`
- `docs/checks/rtl.css.physical-values.md`
- `fixtures/broken/rtl-css-physical-values/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.css.physical-values` from `packages/verify/src/checks/rtl-css-physical-values.ts`; the build discovers it, so edit no registry.
2. Physical properties (`margin-left`) are `rtl.css.physical-property`, from the split.
3. Fix hint: use `start`, `end`, `inline-start`, or `inline-end`.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-css-physical-values/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.css.physical-values.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
