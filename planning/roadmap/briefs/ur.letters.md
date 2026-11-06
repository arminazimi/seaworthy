## Goal
Report Arabic Yeh, Heh, and Kaf (ي ه ك) in Urdu text instead of ی ہ/ھ ک, and missing ے at word ends.

## Files

**Create**
- `packages/verify/src/checks/rtl-ur-letters.ts`
- `packages/verify/tests/rtl-ur-letters.test.ts`
- `docs/checks/rtl.ur.letters.md`
- `fixtures/broken/rtl-ur-letters/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.ur.letters` from `packages/verify/src/checks/rtl-ur-letters.ts`; the build discovers it, so edit no registry.
2. Only when the language is Urdu by `lang` or by Urdu-only letters.
3. Fix hint: replace with the Urdu letters.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-ur-letters/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.ur.letters.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
