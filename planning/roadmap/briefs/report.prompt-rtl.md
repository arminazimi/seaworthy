## Goal
The `prompt` format adds RTL-specific guidance: prefer `dir` and `<bdi>` over control characters, logical CSS over overrides, never change text meaning.

## Files

**Edit**
- `packages/verify/src/formats/prompt.ts`
- `packages/verify/tests/prompts.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Guidance appears only when the report has `rtl.*` findings.

## Done when
- [ ] Golden test of the prompt for a broken fixture.
- [ ] `npm run check` passes.
