## Goal
Report text boxes that overlap other text or controls in RTL but not in LTR.

## Files

**Create**
- `packages/verify/src/checks/rtl-render-overlap.ts`
- `packages/verify/tests/rtl-render-overlap.test.ts`
- `docs/checks/rtl.render.overlap.md`
- `fixtures/broken/rtl-render-overlap/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.render.overlap` from `packages/verify/src/checks/rtl-render-overlap.ts`; the build discovers it, so edit no registry.
2. Ignore intentional overlays (`position: fixed` dialogs, tooltips).
3. Fix hint: use logical properties for the positioned element.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-render-overlap/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.render.overlap.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
