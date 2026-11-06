## Goal
One helper every rendered RTL check uses: open a page at fixed widths, read element boxes and the font actually used, and render the same page forced to LTR for comparison.

## Files

**Create**
- `packages/verify/src/rtl/render.ts`
- `packages/verify/tests/rtl-render.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Reuse `browser.ts` discovery and the existing rendered-check context.
2. One browser per run; pages in parallel up to the core count.
3. Map boxes back to source locations through the HTML positions.

## Done when
- [ ] Tests run when a browser is present and skip cleanly otherwise.
- [ ] `npm run check` passes.
