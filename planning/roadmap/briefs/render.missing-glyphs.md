## Goal
Report RTL characters that render as missing-glyph boxes because no available font covers them.

## Files

**Create**
- `packages/verify/src/checks/rtl-render-missing-glyphs.ts`
- `packages/verify/tests/rtl-render-missing-glyphs.test.ts`
- `docs/checks/rtl.render.missing-glyphs.md`
- `fixtures/broken/rtl-render-missing-glyphs/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.render.missing-glyphs` from `packages/verify/src/checks/rtl-render-missing-glyphs.ts`; the build discovers it, so edit no registry.
2. Compare measured widths against the `.notdef` glyph in the used font.
3. Fix hint: add a font that covers the characters.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-render-missing-glyphs/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.render.missing-glyphs.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
