## Goal
A page that lists every RTL and i18n check by family and language with its severity and one-line purpose, generated from check metadata.

## Files

**Create**
- `tools/rules-catalog.mjs`
- `tools/rules-catalog.test.mjs`
- `docs/rules.md`

**Edit**
- `package.json`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. `--check` mode fails when the page is stale; add it to `npm run check`.

## Done when
- [ ] The catalog lists every built-in `rtl.*` and `i18n.*` check.
- [ ] `npm run check` passes.
