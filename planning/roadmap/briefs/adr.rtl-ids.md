## Goal
Fix the ID scheme every RTL check uses so parallel tasks name things the same way.

## Files

**Create**
- `docs/adr/0015-rtl-check-taxonomy.md`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. IDs: `rtl.dir.*` (document and element direction), `rtl.bidi.*` (bidirectional text), `rtl.css.*` (styles), `rtl.fa.*`, `rtl.ar.*`, `rtl.he.*`, `rtl.ur.*` (language typography), `rtl.render.*` (rendered, needs a browser), and the existing `i18n.*`.
2. Severity rules: error when text is shown wrong to every reader; warning when it is wrong in common cases; note for style.
3. Language detection policy: trust `lang` first, then script detection; never guess between Persian and Arabic on fewer than 20 letters.
4. The existing `rtl.bidi` check is split into `rtl.dir.missing`, `rtl.bidi.mixed-text`, and `rtl.css.physical-property`; the old ID becomes a deprecated alias for one minor version.

## Done when
- [ ] The ADR is merged as Accepted.
- [ ] It lists every check ID planned in the v0.1.0 roadmap.
- [ ] `npm run check` passes.
