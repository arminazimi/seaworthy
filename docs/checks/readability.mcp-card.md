# readability.mcp-card

A published MCP Server Card is not valid JSON, has no `serverInfo` with a name and version, or does not say where the server can be reached.

## Why it matters

An MCP Server Card is a small JSON file at a well-known path that describes a Model Context Protocol server: its name and version, where to connect, and what it offers. An MCP client or an agent can read it to find and configure the server without a human copying settings. A card that does not parse, or that omits the endpoint, makes the server undiscoverable while appearing to advertise it.

**This is a draft that is still moving.** The proposal started as SEP-1649 and, as of September 2026, is being succeeded by SEP-2127, which may rename the path and fields. For that reason this check only reads what the drafts agree on, and every finding says the card is a draft. It is a warning, never an error.

## What it checks

Only when a card exists at one of the paths used by the drafts: `/.well-known/mcp/server-card.json`, `/.well-known/mcp.json`, or `/.well-known/mcp/server-cards.json` (which may hold a `cards` array, checked card by card):

- **Does not parse**, or is not a JSON object.
- **`serverInfo`** is missing, or lacks a non-empty `name` or `version`.
- **No endpoint**: none of `transport` (a string, or an object with `url` or `endpoint`), a `remotes` list with a `url`, `url`, or `endpoint`.

Capabilities, the schema URL, and authentication details are not validated. A site without a card is not reported.

## How to fix

```json
{
  "serverInfo": { "name": "example-docs", "version": "1.0.0" },
  "transport": { "type": "streamable-http", "url": "https://example.com/mcp" },
  "capabilities": { "tools": {} }
}
```

Check the current draft before relying on other fields. There is no automatic edit, because the report cannot know your server.

## Options

None.

## Standards

- [Model Context Protocol](https://modelcontextprotocol.io/) (the card is a draft SEP: 1649, then 2127)
- [Agent-readability spec](../../spec/agent-readability/v1.md)
