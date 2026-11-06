## Goal
Report URLs, email addresses, file paths, and handles in RTL text that are not isolated.

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-urls.ts`
- `packages/verify/tests/rtl-bidi-urls.test.ts`
- `docs/checks/rtl.bidi.urls.md`
- `fixtures/broken/rtl-bidi-urls/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.urls` from `packages/verify/src/checks/rtl-bidi-urls.ts`; the build discovers it, so edit no registry.
2. Links whose text is a URL count; the `href` itself does not.
3. Fix hint: wrap in `<bdi>` or `<span dir="ltr">`.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-bidi-urls/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.bidi.urls.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
