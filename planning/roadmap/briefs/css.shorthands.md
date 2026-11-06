## Goal
Report `margin`, `padding`, `border-width`, `inset`, and `border-color` four-value shorthands whose left and right values differ.

## Files

**Create**
- `packages/verify/src/checks/rtl-css-shorthands.ts`
- `packages/verify/tests/rtl-css-shorthands.test.ts`
- `docs/checks/rtl.css.shorthands.md`
- `fixtures/broken/rtl-css-shorthands/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.css.shorthands` from `packages/verify/src/checks/rtl-css-shorthands.ts`; the build discovers it, so edit no registry.
2. Fix hint: use `margin-inline` / `padding-inline` with start and end values.
3. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
4. Fixture `fixtures/broken/rtl-css-shorthands/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
5. Docs page `docs/checks/rtl.css.shorthands.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
