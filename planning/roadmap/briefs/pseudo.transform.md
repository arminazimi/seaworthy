## Goal
Write a copy of a built site with `dir=rtl`, `lang=ar-XB` (pseudo-locale), and visible text mapped to RTL characters, keeping a map from every output position to the original.

## Files

**Create**
- `packages/verify/src/pseudo/transform.ts`
- `packages/verify/tests/pseudo-transform.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Never touch code, URLs, attribute values other than text attributes, or scripts.
2. Map Latin letters to Hebrew or Arabic look-alike sequences so length stays readable.

## Done when
- [ ] The map points every changed text back to its file, line, and column (tested).
- [ ] `npm run check` passes.
