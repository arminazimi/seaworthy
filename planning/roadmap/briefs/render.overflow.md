## Goal
Report pages that scroll horizontally in RTL but not in LTR at 375, 768, and 1280 px, naming the element that overflows.

## Files

**Create**
- `packages/verify/src/checks/rtl-render-overflow.ts`
- `packages/verify/tests/rtl-render-overflow.test.ts`
- `docs/checks/rtl.render.overflow.md`
- `fixtures/broken/rtl-render-overflow/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.render.overflow` from `packages/verify/src/checks/rtl-render-overflow.ts`; the build discovers it, so edit no registry.
2. Fix hint: fix the element's physical offsets or widths.
3. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
4. Fixture `fixtures/broken/rtl-render-overflow/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
5. Docs page `docs/checks/rtl.render.overflow.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
