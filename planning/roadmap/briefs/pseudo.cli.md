## Goal
One command: transform, run the `rtl.css.*` and `rtl.render.*` checks, and report against the original files.

## Files

**Create**
- `packages/verify/src/cli/pseudo.ts`
- `packages/verify/tests/cli-pseudo.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Options: `--out` to keep the transformed copy, `--expand`, `--widths`.
2. Add the command to `--help`.

## Done when
- [ ] Running it on a clean LTR fixture prints the expected summary (tested).
- [ ] `npm run check` passes.
