## Goal
Pick the fonts for the reference theme: a display serif and a text face for Latin, and matching faces for Persian, with licenses that allow bundling.

## Agent brief

**Files**
- `docs/adr/NNNN-theme-fonts.md` (new)
- `docs/adr/README.md` (add the row)

**Steps**
1. Shortlist at least three Latin serif options and three Persian options (for example Vazirmatn, Sahel, Estedad). Record license (must allow redistribution, such as SIL OFL), weights, and WOFF2 size.
2. Render a test page in both directions with headings, body text, code, and mixed Persian and English text. Check digits, punctuation, and line height.
3. Pick one pairing; record the loading strategy (subset, `font-display`, preload).
4. Write the ADR with screenshots or a description of what you compared.

**Do not**
- Do not add font files to the repo yet.

## Done when
- [ ] The ADR names the fonts, their licenses, and total WOFF2 weight.
- [ ] Every chosen font allows redistribution.
