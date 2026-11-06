## Goal
Report RTL paragraphs and headings that end with an LTR run followed by punctuation (the punctuation shows on the wrong side).

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-trailing-punct.ts`
- `packages/verify/tests/rtl-bidi-trailing-punct.test.ts`
- `docs/checks/rtl.bidi.trailing-punct.md`
- `fixtures/broken/rtl-bidi-trailing-punct/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.trailing-punct` from `packages/verify/src/checks/rtl-bidi-trailing-punct.ts`; the build discovers it, so edit no registry.
2. Also list items and table cells.
3. Fix hint: isolate the LTR run so the punctuation stays with the RTL text.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-bidi-trailing-punct/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.bidi.trailing-punct.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
