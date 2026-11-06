## Goal
Record the new direction: Seaworthy becomes the reference tool for testing right-to-left and multilingual websites, because no maintained open-source tool does this, while agent-readiness checking is crowded.

## Files

**Create**
- `docs/adr/0014-rtl-focus.md`

**Edit**
- `docs/adr/README.md`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Context: the agent-readiness market (Cloudflare, Vercel, Lighthouse, GEO Optimizer, and many free scanners); the RTL gap (BidiChecker unmaintained since about 2011, no CI tool).
2. Decision: v0.1.0 ships RTL and i18n checks, a pseudo-RTL mode, and an RTL score; existing checks stay but leave the default profile; `readability.*` is frozen.
3. Consequences: languages in scope (Persian, Arabic, Hebrew, Urdu first), what is frozen, and that the engine, report, MCP server, and Action are reused as they are.
4. List ADRs this supersedes in part (positioning ADRs) without editing them.

## Done when
- [ ] The ADR is merged as Accepted and listed in the index.
- [ ] `npm run check` passes.
