## Goal
Report RTL direction set with the CSS `direction` property instead of the `dir` attribute (lost for screen readers, search engines, and copy and paste).

## Files

**Create**
- `packages/verify/src/checks/rtl-dir-css-direction.ts`
- `packages/verify/tests/rtl-dir-css-direction.test.ts`
- `docs/checks/rtl.dir.css-direction.md`
- `fixtures/broken/rtl-dir-css-direction/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.dir.css-direction` from `packages/verify/src/checks/rtl-dir-css-direction.ts`; the build discovers it, so edit no registry.
2. Use the CSS model; report the declaration and the elements it applies to once.
3. Fix hint: use the `dir` attribute and remove the declaration.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-dir-css-direction/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.dir.css-direction.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
