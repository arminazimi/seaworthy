# readability.a2a-card

An A2A agent card at `/.well-known/agent-card.json` is not valid JSON, or is missing fields the A2A specification requires.

## Why it matters

The Agent2Agent (A2A) protocol lets one AI agent find and call another. An agent publishes a card describing who it is, where it can be reached, what it supports, and what skills it offers; clients read it from `/.well-known/agent-card.json` before they talk to the agent. A card that does not parse or lacks required fields is rejected by clients, so the agent cannot be found even though the file exists.

## What it checks

Only when the card exists. It follows A2A 1.0 (section 4.4.1 and 4.4.5 of the specification, read on 2026-10-18):

- **Does not parse**, or is not a JSON object.
- **Text fields**: `name`, `description`, `version` non-empty.
- **Where it is reached**: `supportedInterfaces` is a non-empty list in which every entry has a `url`. The older single top-level `url` (A2A 0.3) is accepted instead.
- **`capabilities`** is an object.
- **Lists**: `defaultInputModes`, `defaultOutputModes`, and `skills` are present as lists.
- **Each skill** has non-empty `id`, `name`, and `description`, and a `tags` list.

Optional fields (`provider`, `documentationUrl`, `securitySchemes`, `signatures`, and the rest) are not validated, nor are media types, security details, or the reachability of the URLs. A site without a card is not reported.

## How to fix

```json
{
  "name": "Docs agent",
  "description": "Answers questions about the documentation.",
  "version": "1.0.0",
  "supportedInterfaces": [{ "url": "https://example.com/a2a", "protocolBinding": "JSONRPC" }],
  "capabilities": { "streaming": true },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [{ "id": "answer", "name": "Answer", "description": "Answers questions.", "tags": ["docs"] }]
}
```

Generate the card from the same configuration the agent runs with, so the two cannot disagree. There is no automatic edit, because the report cannot know your agent.

## Options

None.

## Standards

- [A2A Protocol specification 1.0](https://a2a-protocol.org/latest/specification/)
- [Agent-readability spec](../../spec/agent-readability/v1.md)
