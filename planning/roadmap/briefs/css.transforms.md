## Goal
Report `translateX`, `rotate`, and `scaleX(-1)` hacks used for directional movement or icons in styles for RTL pages without an RTL override.

## Files

**Create**
- `packages/verify/src/checks/rtl-css-transforms.ts`
- `packages/verify/tests/rtl-css-transforms.test.ts`
- `docs/checks/rtl.css.transforms.md`
- `fixtures/broken/rtl-css-transforms/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.css.transforms` from `packages/verify/src/checks/rtl-css-transforms.ts`; the build discovers it, so edit no registry.
2. Only report when a `[dir=rtl]` or `:dir(rtl)` override is missing.
3. Fix hint: add a `:dir(rtl)` override or use logical layout.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-css-transforms/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.css.transforms.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
