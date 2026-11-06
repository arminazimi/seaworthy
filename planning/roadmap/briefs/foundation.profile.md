## Goal
`seaworthy verify` runs the RTL and i18n checks (and the accessibility checks they need) by default; `--profile all` keeps every other check reachable.

## Files

**Create**
- `spec/config/fragments/profile.json`
- `packages/verify/src/profiles.ts`
- `packages/verify/tests/profiles.test.ts`

**Edit**
- `packages/verify/src/config.ts`
- `spec/config/v0.schema.json`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Profiles select checks by ID prefix.
2. Regenerate the config schema with `npm run schema:build`.
3. A config file's `checks` settings still win over the profile.

## Done when
- [ ] `seaworthy verify` on a clean fixture runs only `rtl.*`, `i18n.*`, and the listed `a11y.*` checks (tested).
- [ ] `npm run check` passes.
