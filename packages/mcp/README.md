# @seaworthy/mcp

The MCP server: a thin adapter over the verify API (AGENTS.md keeps check logic out of here). It
speaks JSON-RPC over stdio — `seaworthy-mcp`, `src/main.ts` — and serves `list_checks`,
`verify_site` and `verify_changed`; the tools still planned are listed in `src/planned.ts` and stay
unregistered until they ship.

## Resources

Every check's contract page is a readable resource, served from one URI template
(`seaworthy://checks/{check_id}/docs`, `src/check-docs.ts`): `resources/list` returns one entry per
check the server knows — named by its check ID, titled with verify's own check title, typed
`text/markdown` — and `resources/read` returns that page from `docs/checks/<id>.md` as it is. The
list is built from verify's check metadata, so no check ID is invented and no other file is
addressable; an install that ships no docs pages answers with the check's own `docs` URL rather
than a guess. No site is read and no network is used.

## Registry metadata

`server.json` here is this server's entry for the official MCP Registry
(`registry.modelcontextprotocol.io`), in the location the registry's publisher expects: the server's
own project directory, validated against
`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`.

- `name` must equal the `mcpName` field of `package.json`; that pairing is how the registry verifies
  package ownership.
- `version` mirrors this package's `version`, which `src/version.ts` also reads for the initialize
  handshake. There is one source of truth, guarded by `tools/server-json.test.mjs`.

**Pre-alpha, and the file says so.** `@seaworthy/mcp`, `@seaworthy/verify` and the `@seaworthy` npm
scope are not published or claimed yet (see the name status note in `ROADMAP.md`), so this entry
cannot be published to the registry today: publishing the package to npm is the remaining gate.
When that happens, drop `private` from `package.json`, ship the entry with
`mcp-publisher validate server.json && mcp-publisher publish server.json`, and update `version` and
the `_meta` note in the same commit.
