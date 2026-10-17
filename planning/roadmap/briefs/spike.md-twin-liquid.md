## Goal
Find out whether plain GitHub Pages (no Actions, only whitelisted plugins) can publish a raw Markdown copy of each page, so the reference theme knows where Markdown twins come from.

## Agent brief

**Files**
- `docs/adr/NNNN-markdown-twin.md` (new)
- `docs/adr/README.md` (add the row)

**Steps**
1. Check the current GitHub Pages plugin whitelist and Jekyll version.
2. Try generating `/path/index.md` next to each page using only Liquid and whitelisted plugins (for example a collection or page that outputs `page.content` before conversion). Record exactly what works and what does not.
3. If it does not work in plain Pages, describe the Actions-mode alternative (a build step that writes the twins).
4. Write the ADR with the result and the theme's behavior in each mode.

**Do not**
- Do not add the theme implementation; `theme.md-twin` does that.

## Done when
- [ ] The ADR says yes or no for plain Pages, with a minimal reproduction.
- [ ] The Actions-mode fallback is described.
