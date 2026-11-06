## Goal
Report `,` `;` `?` used in Persian sentences instead of `،` `؛` `؟`.

## Files

**Create**
- `packages/verify/src/checks/rtl-fa-punctuation.ts`
- `packages/verify/tests/rtl-fa-punctuation.test.ts`
- `docs/checks/rtl.fa.punctuation.md`
- `fixtures/broken/rtl-fa-punctuation/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.fa.punctuation` from `packages/verify/src/checks/rtl-fa-punctuation.ts`; the build discovers it, so edit no registry.
2. Only between Persian words.
3. Fix hint: use the Persian marks.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-fa-punctuation/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.fa.punctuation.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
