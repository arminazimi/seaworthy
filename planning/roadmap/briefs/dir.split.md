## Goal
Turn the three signals of today's `rtl.bidi` into three checks with their own IDs, docs, and fixtures, using the shared modules.

## Files

**Create**
- `packages/verify/src/checks/rtl-dir-missing.ts`
- `packages/verify/src/checks/rtl-bidi-mixed-text.ts`
- `packages/verify/src/checks/rtl-css-physical-property.ts`
- `docs/checks/rtl.dir.missing.md`
- `docs/checks/rtl.bidi.mixed-text.md`
- `docs/checks/rtl.css.physical-property.md`

**Edit**
- `packages/verify/src/checks/rtl.ts`
- `packages/verify/tests/rtl.test.ts`
- `docs/checks/rtl.bidi.md`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Keep `rtl.bidi` as a deprecated alias that runs the three and says so once.
2. Move the existing tests to the new IDs; findings and locations stay the same.

## Done when
- [ ] The three checks report exactly what `rtl.bidi` reported before, under the new IDs (golden test).
- [ ] `rtl.bidi` prints a deprecation note.
- [ ] `npm run check` passes.
