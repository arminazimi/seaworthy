## Goal
Define and compute a 0–100 RTL score per page and per site, so teams and agents track progress with one number.

## Files

**Create**
- `spec/rtl-score/v0.md`
- `packages/verify/src/rtl/score.ts`
- `packages/verify/tests/rtl-score.test.ts`
- `spec/report/fragments/fields/rtlScore.json`

**Edit**
- `spec/report/v0.schema.json`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Weights by check family and severity, capped per family so one noisy rule cannot zero a page.
2. Pages with no RTL content are not scored.
3. Regenerate the report schema with `npm run schema:build`.

## Done when
- [ ] The score of each clean fixture is 100 and each broken fixture's is below 100 (tested).
- [ ] `npm run check` passes.
