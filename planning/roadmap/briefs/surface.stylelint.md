## Goal
Catch `rtl.css.*` problems in source CSS before the build: physical properties and values, shorthands, letter spacing on Arabic-script selectors, with autofix to logical CSS.

## Files

**Create**
- `packages/stylelint/package.json`
- `packages/stylelint/src/index.ts`
- `packages/stylelint/tests/plugin.test.ts`
- `packages/stylelint/README.md`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Share the logical-CSS table with `packages/verify/src/rtl/logical.ts` (import it; do not copy).

## Done when
- [ ] Tests cover each rule and its autofix.
- [ ] `npm run check` passes.
