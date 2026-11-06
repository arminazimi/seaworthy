## Goal
Resolve the effective direction and language of every element (inherited `dir` and `lang`, `dir=auto`) so checks agree on what is right-to-left.

## Files

**Create**
- `packages/verify/src/rtl/scope.ts`
- `packages/verify/tests/rtl-scope.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. `directionOf(element)`, `languageOf(element)`, `rtlPages(site)`.
2. `dir=auto` resolves from the first strong character, as browsers do.

## Done when
- [ ] Tests cover nested overrides, `dir=auto`, and pages with no `lang`.
- [ ] `npm run check` passes.
