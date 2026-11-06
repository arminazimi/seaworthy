## Goal
A fixture LTR site with known RTL bugs (physical CSS, unmirrored arrows, fixed widths) and the exact findings pseudo-RTL must report.

## Files

**Create**
- `fixtures/broken/pseudo-rtl/`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Include `fixture.json` that runs the pseudo flow.

## Done when
- [ ] The fixture passes in `npm test`.
- [ ] `npm run check` passes.
