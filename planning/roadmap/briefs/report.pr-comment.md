## Goal
The Markdown format used for pull request comments leads with the RTL score, its change from the base run, and up to five findings per language.

## Files

**Edit**
- `packages/verify/src/formats/markdown.ts`
- `packages/verify/tests/cli-markdown.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Reuse the existing diff support for the change.

## Done when
- [ ] Golden test of the comment for a broken fixture.
- [ ] `npm run check` passes.
