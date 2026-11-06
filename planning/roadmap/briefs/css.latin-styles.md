## Goal
Report `font-style: italic`, `text-transform`, `font-variant: small-caps`, and `font-synthesis` faux styles applied to Arabic-script or Hebrew text.

## Files

**Create**
- `packages/verify/src/checks/rtl-css-latin-styles.ts`
- `packages/verify/tests/rtl-css-latin-styles.test.ts`
- `docs/checks/rtl.css.latin-styles.md`
- `fixtures/broken/rtl-css-latin-styles/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.css.latin-styles` from `packages/verify/src/checks/rtl-css-latin-styles.ts`; the build discovers it, so edit no registry.
2. Fix hint: use weight or color for emphasis on these scripts.
3. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
4. Fixture `fixtures/broken/rtl-css-latin-styles/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
5. Docs page `docs/checks/rtl.css.latin-styles.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
