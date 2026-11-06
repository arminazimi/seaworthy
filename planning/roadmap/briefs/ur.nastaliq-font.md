## Goal
Report Urdu text whose font stack has no Nastaliq font (Noto Nastaliq Urdu, Jameel Noori Nastaleeq, and others).

## Files

**Create**
- `packages/verify/src/checks/rtl-ur-nastaliq-font.ts`
- `packages/verify/tests/rtl-ur-nastaliq-font.test.ts`
- `docs/checks/rtl.ur.nastaliq-font.md`
- `fixtures/broken/rtl-ur-nastaliq-font/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.ur.nastaliq-font` from `packages/verify/src/checks/rtl-ur-nastaliq-font.ts`; the build discovers it, so edit no registry.
2. Uses the CSS model; a note, not an error.
3. Fix hint: add a Nastaliq font first in the stack.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-ur-nastaliq-font/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.ur.nastaliq-font.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
