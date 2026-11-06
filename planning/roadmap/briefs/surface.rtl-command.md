## Goal
A short command that runs the `rtl` profile and prints the score and per-language summary first.

## Files

**Create**
- `packages/verify/src/cli/rtl.ts`
- `packages/verify/tests/cli-rtl.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Same options as `verify`; add `--lang` to limit languages.

## Done when
- [ ] Help text and a golden output test.
- [ ] `npm run check` passes.
