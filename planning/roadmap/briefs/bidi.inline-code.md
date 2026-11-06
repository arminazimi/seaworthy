## Goal
Report `code`, `kbd`, `samp`, and `var` inside RTL paragraphs that are not LTR and contain neutral characters.

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-inline-code.ts`
- `packages/verify/tests/rtl-bidi-inline-code.test.ts`
- `docs/checks/rtl.bidi.inline-code.md`
- `fixtures/broken/rtl-bidi-inline-code/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.inline-code` from `packages/verify/src/checks/rtl-bidi-inline-code.ts`; the build discovers it, so edit no registry.
2. Blocks are `rtl.dir.code-blocks`; this is inline only.
3. Fix hint: add `dir="ltr"` to the element.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-bidi-inline-code/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.bidi.inline-code.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
