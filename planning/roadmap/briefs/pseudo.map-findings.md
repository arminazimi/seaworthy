## Goal
Every finding on the transformed copy is reported at the original file and position, with the original snippet.

## Files

**Create**
- `packages/verify/src/pseudo/map.ts`
- `packages/verify/tests/pseudo-map.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. CSS findings already point at original stylesheets; HTML findings go through the transform map.

## Done when
- [ ] Golden test on the pseudo fixture.
- [ ] `npm run check` passes.
