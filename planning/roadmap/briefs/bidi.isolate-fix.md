## Goal
One function that turns a text run's position into an `Edit` wrapping it in `<bdi>` or `<span dir=…>`, so every bidi check offers the same safe fix.

## Files

**Create**
- `packages/verify/src/rtl/isolate.ts`
- `packages/verify/tests/rtl-isolate.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Edits only when the run is inside one text node on one line; otherwise no edit, only the hint.
2. Choose `<bdi>` for user-like content and `dir="ltr"` spans for code, URLs, and numbers.

## Done when
- [ ] Tests cover runs at line start, line end, and next to entities.
- [ ] `npm run check` passes.
