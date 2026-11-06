## Goal
Report elements whose `lang` is a right-to-left language but whose direction resolves to LTR, and the reverse.

## Files

**Create**
- `packages/verify/src/checks/rtl-dir-lang-mismatch.ts`
- `packages/verify/tests/rtl-dir-lang-mismatch.test.ts`
- `docs/checks/rtl.dir.lang-mismatch.md`
- `fixtures/broken/rtl-dir-lang-mismatch/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.dir.lang-mismatch` from `packages/verify/src/checks/rtl-dir-lang-mismatch.ts`; the build discovers it, so edit no registry.
2. Use `directionOf` and `languageOf`; report once per element that sets either attribute.
3. Fix hint: set `dir` to match `lang`, or fix `lang`.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-dir-lang-mismatch/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.dir.lang-mismatch.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
