## Goal
Make `seaworthy fix` apply every unambiguous Persian fix (letters, digits, extra ZWNJ, punctuation) in one pass, never inside code, URLs, or attributes.

## Files

**Create**
- `packages/verify/src/rtl/fa-fix.ts`
- `packages/verify/tests/rtl-fa-fix.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Collect the `Edit`s the checks attach; merge overlapping edits deterministically.
2. Dry run shows a unified diff.

## Done when
- [ ] After the fix pack, the Persian broken fixtures report nothing for those four checks (tested).
- [ ] `npm run check` passes.
