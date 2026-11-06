## Goal
Report phone numbers, versions, ranges, and numbers with signs or separators (`-12`, `1.2.3`, `+98 21`, `10-20`) inside RTL text that are not isolated and so display reordered.

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-numbers.ts`
- `packages/verify/tests/rtl-bidi-numbers.test.ts`
- `docs/checks/rtl.bidi.numbers.md`
- `fixtures/broken/rtl-bidi-numbers/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.numbers` from `packages/verify/src/checks/rtl-bidi-numbers.ts`; the build discovers it, so edit no registry.
2. Only numbers whose characters include a neutral or weak separator.
3. Persian and Arabic-Indic digits count.
4. Fix hint: wrap the number in `<span dir="ltr">`.
5. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
6. Fixture `fixtures/broken/rtl-bidi-numbers/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
7. Docs page `docs/checks/rtl.bidi.numbers.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
