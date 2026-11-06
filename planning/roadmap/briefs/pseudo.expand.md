## Goal
`--expand 30` lengthens text by a percentage to show truncation and overflow that translation will cause.

## Files

**Create**
- `packages/verify/src/pseudo/expand.ts`
- `packages/verify/tests/pseudo-expand.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Pad with marked characters at word ends; keep the map exact.

## Done when
- [ ] Tests cover 0, 30, and 100%.
- [ ] `npm run check` passes.
