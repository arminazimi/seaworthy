## Goal
Report embedding, override, and isolate controls (LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI) that are not closed in the same paragraph.

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-controls.ts`
- `packages/verify/tests/rtl-bidi-controls.test.ts`
- `docs/checks/rtl.bidi.controls.md`
- `fixtures/broken/rtl-bidi-controls/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.controls` from `packages/verify/src/checks/rtl-bidi-controls.ts`; the build discovers it, so edit no registry.
2. Report the opening character's position.
3. Fix hint: close the control, or use `<bdi>` and `dir` instead.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-bidi-controls/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.bidi.controls.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
