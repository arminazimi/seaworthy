## Goal
Report runs of right-to-left text of 20 or more letters inside an element whose language is not right-to-left and that set no `lang` (screen readers then read it with the wrong voice).

## Files

**Create**
- `packages/verify/src/checks/rtl-dir-lang-fragment.ts`
- `packages/verify/tests/rtl-dir-lang-fragment.test.ts`
- `docs/checks/rtl.dir.lang-fragment.md`
- `fixtures/broken/rtl-dir-lang-fragment/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.dir.lang-fragment` from `packages/verify/src/checks/rtl-dir-lang-fragment.ts`; the build discovers it, so edit no registry.
2. Report on the nearest block element.
3. Fix hint: wrap the text in an element with `lang` and `dir`.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-dir-lang-fragment/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.dir.lang-fragment.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
