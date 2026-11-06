## Goal
Add a `languages` summary to the report: pages, findings, and score per language.

## Files

**Create**
- `packages/verify/src/rtl/languages.ts`
- `packages/verify/tests/rtl-languages.test.ts`
- `spec/report/fragments/fields/languages.json`

**Edit**
- `spec/report/v0.schema.json`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Language from `lang`, else the guesser.
2. Regenerate the report schema.

## Done when
- [ ] The summary appears in JSON and in the pretty output.
- [ ] `npm run check` passes.
