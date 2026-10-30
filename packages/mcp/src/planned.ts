// MCP server for Seaworthy. Tools planned but not implemented yet: none — every tool named in the
// server's history has shipped. `list_checks` ships with the server skeleton (issue #76),
// `verify_site` and `verify_changed` with the verify tools (issue #77), `explain_finding` with the
// finding explainer (issue #78), and `get_config_schema` / `create_baseline` with the config tools
// (issue #80); a tool leaves this list as it ships.
// Only tools registered on the server appear in a client's tool list; planned-but-unbuilt tools are never advertised.

export const PLANNED_TOOLS = [] as const;
