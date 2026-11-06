## Goal
Report bidi override and isolate characters inside `pre`, `code`, and source-like text, where they can make code read differently than it runs (CVE-2021-42574).

## Files

**Create**
- `packages/verify/src/checks/rtl-bidi-trojan.ts`
- `packages/verify/tests/rtl-bidi-trojan.test.ts`
- `docs/checks/rtl.bidi.trojan.md`
- `fixtures/broken/rtl-bidi-trojan/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Export a `Check` with ID `rtl.bidi.trojan` from `packages/verify/src/checks/rtl-bidi-trojan.ts`; the build discovers it, so edit no registry.
2. Error by default.
3. Fix hint: remove the control characters.
4. Scope: only pages and elements that `foundation.rtl-scope` marks as right-to-left, unless the rule says otherwise.
5. Fixture `fixtures/broken/rtl-bidi-trojan/` with `site/`, `expected.json` (exact findings with line and column), and `fixture.json` limited to this check.
6. Docs page `docs/checks/rtl.bidi.trojan.md` with Why it matters, What it checks, and How to fix (before and after, in Persian or Arabic where it applies).

## Done when
- [ ] The check reports every case in its broken fixture with exact locations, and nothing on any clean fixture (including `fixtures/clean/rtl-*`).
- [ ] Every finding has a fix hint; where a safe edit exists, the finding carries it as an `Edit`.
- [ ] The docs page exists and `npm test` finds it.
- [ ] `npm run check` passes.
