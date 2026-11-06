## Goal
Report RTL text whose rendered font is not in its declared stack (the web font failed or does not cover the script).

## Files

**Create**
- `packages/verify/src/checks/rtl-render-fallback-font.ts`
- `packages/verify/tests/rtl-render-fallback-font.test.ts`
- `docs/checks/rtl.render.fallback-font.md`
- `fixtures/broken/rtl-render-fallback-font/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.render.fallback-font` from `packages/verify/src/checks/rtl-render-fallback-font.ts`; the build discovers it, so edit no registry.
2. Read the used font from the browser's font information.
3. Fix hint: fix the `@font-face` source or `unicode-range`.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-render-fallback-font/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.render.fallback-font.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
