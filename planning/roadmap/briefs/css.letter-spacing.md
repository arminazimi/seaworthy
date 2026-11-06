## Goal
Report non-zero `letter-spacing` that applies to Arabic-script text (it breaks letter joining).

## Files

**Create**
- `packages/verify/src/checks/rtl-css-letter-spacing.ts`
- `packages/verify/tests/rtl-css-letter-spacing.test.ts`
- `docs/checks/rtl.css.letter-spacing.md`
- `fixtures/broken/rtl-css-letter-spacing/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.css.letter-spacing` from `packages/verify/src/checks/rtl-css-letter-spacing.ts`; the build discovers it, so edit no registry.
2. Use the CSS model and the elements' text; Hebrew is not joined and is excluded.
3. Fix hint: set `letter-spacing: 0` for `:lang(fa)`, `:lang(ar)`, and `:lang(ur)`.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-css-letter-spacing/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.css.letter-spacing.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
