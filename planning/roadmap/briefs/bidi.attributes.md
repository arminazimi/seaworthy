## Goal
Report attribute text with mixed directions on elements whose direction is wrong for it (tooltips and screen readers show it reordered).

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-attributes.ts`
- `packages/verify/tests/rtl-bidi-attributes.test.ts`
- `docs/checks/rtl.bidi.attributes.md`
- `fixtures/broken/rtl-bidi-attributes/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.attributes` from `packages/verify/src/checks/rtl-bidi-attributes.ts`; the build discovers it, so edit no registry.
2. Attributes: `alt`, `title`, `placeholder`, `aria-label`, `aria-description`.
3. Fix hint: set `dir` on the element or rephrase so the base direction is right.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-bidi-attributes/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.bidi.attributes.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
