## Goal
Report ZWNJ next to a space, at a word edge, doubled, or after a letter that never joins.

## Files

**Create**
- `packages/verify/src/checks/rtl-fa-zwnj-misuse.ts`
- `packages/verify/tests/rtl-fa-zwnj-misuse.test.ts`
- `docs/checks/rtl.fa.zwnj-misuse.md`
- `fixtures/broken/rtl-fa-zwnj-misuse/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.fa.zwnj-misuse` from `packages/verify/src/checks/rtl-fa-zwnj-misuse.ts`; the build discovers it, so edit no registry.
2. Fix hint: remove the extra ZWNJ.
3. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
4. Fixture `fixtures/broken/rtl-fa-zwnj-misuse/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
5. Docs page `docs/checks/rtl.fa.zwnj-misuse.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
