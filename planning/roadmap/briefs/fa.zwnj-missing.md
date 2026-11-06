## Goal
Report Persian words that need a ZWNJ and have a space or nothing instead: the prefixes می and نمی, the suffixes ها، های، ترین، تر، ام، ای، اند after joining letters.

## Files

**Create**
- `packages/verify/src/checks/rtl-fa-zwnj-missing.ts`
- `packages/verify/tests/rtl-fa-zwnj-missing.test.ts`
- `docs/checks/rtl.fa.zwnj-missing.md`
- `fixtures/broken/rtl-fa-zwnj-missing/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.fa.zwnj-missing` from `packages/verify/src/checks/rtl-fa-zwnj-missing.ts`; the build discovers it, so edit no registry.
2. Data-driven rule list in the module; avoid known exceptions (for example نمی‌دانم is fine, میز is not a prefix).
3. Fix hint: replace the space with ZWNJ (U+200C).
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-fa-zwnj-missing/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.fa.zwnj-missing.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
