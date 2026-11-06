## Goal
One function that maps a physical declaration to its logical form (`margin-left` → `margin-inline-start`, `text-align: left` → `start`, `float: left` → `inline-start`) and returns an `Edit` when the mapping is exact.

## Files

**Create**
- `packages/verify/src/rtl/logical.ts`
- `packages/verify/tests/rtl-logical.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Table-driven; no edit when the mapping depends on context (for example `left` in `position`).

## Done when
- [ ] Every property in the table has a test.
- [ ] `npm run check` passes.
