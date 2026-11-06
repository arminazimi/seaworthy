## Goal
Two MCP tools so coding agents can check RTL quality and run pseudo-RTL, returning findings with edits.

## Files

**Create**
- `packages/mcp/src/rtl-check.ts`
- `packages/mcp/src/pseudo-rtl.ts`
- `packages/mcp/tests/rtl-tools.test.ts`

Touch no other file. If one must change, stop and say why in the issue.

## Steps
1. Thin adapters over the verify API; no check logic in the MCP package.

## Done when
- [ ] The tools appear in `list_checks` output and pass their tests.
- [ ] `npm run check` passes.
