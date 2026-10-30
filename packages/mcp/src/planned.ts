// MCP server for Seaworthy. Tools planned but not implemented yet: get_config_schema,
// create_baseline. `list_checks` ships with the server skeleton (issue #76), `verify_site` and
// `verify_changed` with the verify tools (issue #77), and `explain_finding` with the finding
// explainer (issue #78); a tool leaves this list as it ships.
// Only tools registered on the server appear in a client's tool list; planned-but-unbuilt tools are never advertised.

export const PLANNED_TOOLS = ["get_config_schema", "create_baseline"] as const;
