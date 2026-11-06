## Goal
Report arrows, chevrons, back and forward icons, and progress icons that point the same way in RTL as in LTR.

## Files

**Create**
- `packages/verify/src/checks/rtl-render-mirrored-icons.ts`
- `packages/verify/tests/rtl-render-mirrored-icons.test.ts`
- `docs/checks/rtl.render.mirrored-icons.md`
- `fixtures/broken/rtl-render-mirrored-icons/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.render.mirrored-icons` from `packages/verify/src/checks/rtl-render-mirrored-icons.ts`; the build discovers it, so edit no registry.
2. Find candidates by name (class, `aria-label`, file name) and by comparing the LTR and RTL renderings of the icon's box and pixels.
3. Do not report icons that must not mirror (play, clock, checkmark, logos).
4. Fix hint: mirror with `:dir(rtl) { transform: scaleX(-1) }` or swap the icon.
5. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
6. Fixture `fixtures/broken/rtl-render-mirrored-icons/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
7. Docs page `docs/checks/rtl.render.mirrored-icons.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
