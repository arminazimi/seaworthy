## Goal
Report tatweel characters inside Persian words, used to stretch text, which break search and copy.

## Files

**Create**
- `packages/verify/src/checks/rtl-fa-kashida.ts`
- `packages/verify/tests/rtl-fa-kashida.test.ts`
- `docs/checks/rtl.fa.kashida.md`
- `fixtures/broken/rtl-fa-kashida/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.fa.kashida` from `packages/verify/src/checks/rtl-fa-kashida.ts`; the build discovers it, so edit no registry.
2. Fix hint: remove the kashida; use CSS `text-align: justify` if needed.
3. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
4. Fixture `fixtures/broken/rtl-fa-kashida/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
5. Docs page `docs/checks/rtl.fa.kashida.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
