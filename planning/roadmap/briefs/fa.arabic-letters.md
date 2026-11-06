## Goal
Report Arabic Yeh (ي), Kaf (ك), and Alef Maksura (ى) in Persian text, which break search and sort.

## Files

**Create**
- `packages/verify/src/checks/rtl-fa-arabic-letters.ts`
- `packages/verify/tests/rtl-fa-arabic-letters.test.ts`
- `docs/checks/rtl.fa.arabic-letters.md`
- `fixtures/broken/rtl-fa-arabic-letters/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.fa.arabic-letters` from `packages/verify/src/checks/rtl-fa-arabic-letters.ts`; the build discovers it, so edit no registry.
2. Skip quoted Arabic (an element with `lang=ar`).
3. Fix hint: replace with ی and ک.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-fa-arabic-letters/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.fa.arabic-letters.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
