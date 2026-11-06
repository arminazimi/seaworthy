## Goal
A small package so end-to-end tests can assert RTL quality on the page they already have open.

## Files

**Create**
- `packages/playwright/package.json`
- `packages/playwright/src/index.ts`
- `packages/playwright/tests/matcher.test.ts`
- `packages/playwright/README.md`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Runs static and rendered RTL checks on the live DOM; options select check families.
2. Peer dependency on `@playwright/test`.

## Done when
- [ ] Tests run against a local page.
- [ ] `npm run check` passes.
