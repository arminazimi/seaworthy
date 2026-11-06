## Goal
One module every RTL check uses to walk visible text with exact file positions and to tell Arabic, Persian, Urdu, Hebrew, and Latin apart.

## Files

**Create**
- `packages/verify/src/rtl/text.ts`
- `packages/verify/tests/rtl-text.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Script of a character (Arabic, Hebrew, Thaana, Syriac, NKo, Latin, digits by script) from Unicode ranges.
2. `textRuns(page)`: visible text nodes with file, line, and column, skipping script, style, template, and hidden elements.
3. `guessLanguage(text)`: fa, ar, ur, he, or unknown, using distinctive letters (پ چ ژ گ for Persian, ٹ ڈ ڑ ں ے for Urdu, Hebrew block) and the 20-letter minimum from ADR 0015.
4. Move the shared pieces now inside `checks/rtl.ts` and `rtl-data.ts` here without changing that check's output.

## Done when
- [ ] Tests cover every script and each language on short and long samples.
- [ ] `rtl.bidi` output is unchanged (its tests pass untouched).
- [ ] `npm run check` passes.
