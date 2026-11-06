## Goal
Report pages whose visible text is mostly Arabic-script or Hebrew while `lang` and `dir` say otherwise, and the reverse.

## Files

**Create**
- `packages/verify/src/checks/rtl-dir-content-mismatch.ts`
- `packages/verify/tests/rtl-dir-content-mismatch.test.ts`
- `docs/checks/rtl.dir.content-mismatch.md`
- `fixtures/broken/rtl-dir-content-mismatch/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.dir.content-mismatch` from `packages/verify/src/checks/rtl-dir-content-mismatch.ts`; the build discovers it, so edit no registry.
2. More than 60% of letters in RTL scripts and at least 200 letters.
3. Name the detected language in the message.
4. Fix hint: set `lang` and `dir` on `<html>`.
5. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
6. Fixture `fixtures/broken/rtl-dir-content-mismatch/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
7. Docs page `docs/checks/rtl.dir.content-mismatch.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
