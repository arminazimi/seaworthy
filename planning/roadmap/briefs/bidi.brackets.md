## Goal
Report brackets and quotes around mixed-direction text that pair across directions, and hard-coded mirrored brackets (`)` written to look like `(`).

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-brackets.ts`
- `packages/verify/tests/rtl-bidi-brackets.test.ts`
- `docs/checks/rtl.bidi.brackets.md`
- `fixtures/broken/rtl-bidi-brackets/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.brackets` from `packages/verify/src/checks/rtl-bidi-brackets.ts`; the build discovers it, so edit no registry.
2. Use Unicode bidi bracket pairs.
3. Fix hint: isolate the inner text, and write brackets in logical order.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-bidi-brackets/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.bidi.brackets.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
