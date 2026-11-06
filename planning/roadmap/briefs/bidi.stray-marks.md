## Goal
Report LRM, RLM, and ALM characters that change nothing (between two strong characters of the same direction), which break search and copy.

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-stray-marks.ts`
- `packages/verify/tests/rtl-bidi-stray-marks.test.ts`
- `docs/checks/rtl.bidi.stray-marks.md`
- `fixtures/broken/rtl-bidi-stray-marks/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.stray-marks` from `packages/verify/src/checks/rtl-bidi-stray-marks.ts`; the build discovers it, so edit no registry.
2. Note severity.
3. Fix hint: remove the mark.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-bidi-stray-marks/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.bidi.stray-marks.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
