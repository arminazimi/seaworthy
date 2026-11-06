## Goal
SARIF rules and results carry `tags` with the check family, script, and language, so code scanning can filter RTL findings.

## Files

**Edit**
- `packages/verify/src/formats/sarif.ts`
- `packages/verify/tests/sarif.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Tags such as `rtl`, `bidi`, `script:arabic`, `lang:fa`.

## Done when
- [ ] SARIF output still validates against the SARIF 2.1.0 schema (tested).
- [ ] `npm run check` passes.
