// MCP server for Seaworthy. Tools planned but not implemented yet: explain_finding, get_config_schema,
// create_baseline. `list_checks` ships with the server skeleton (issue #76) and `verify_site` /
// `verify_changed` with the verify tools (issue #77); a tool leaves this list as it ships.
// Only tools registered on the server appear in a client's tool list; planned-but-unbuilt tools are never advertised.

export const PLANNED_TOOLS = ["explain_finding", "get_config_schema", "create_baseline"] as const;
