## Goal
Report `pre`, `code`, `kbd`, and `samp` inside RTL content that are not LTR (code then displays with punctuation and order reversed).

## Files

**Create**
- `packages/verify/src/checks/rtl-dir-code-blocks.ts`
- `packages/verify/tests/rtl-dir-code-blocks.test.ts`
- `docs/checks/rtl.dir.code-blocks.md`
- `fixtures/broken/rtl-dir-code-blocks/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.dir.code-blocks` from `packages/verify/src/checks/rtl-dir-code-blocks.ts`; the build discovers it, so edit no registry.
2. Inherited `dir=ltr` or CSS `direction: ltr` on the element counts as fixed.
3. Fix hint: add `dir="ltr"` to the code element.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-dir-code-blocks/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.dir.code-blocks.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
