// MCP server for Seaworthy. Tools planned: verify_site, verify_changed, explain_finding, list_checks, get_config_schema, create_baseline.
// `list_checks` ships with the server skeleton (issue #76); the rest land with later issues (#77+).
// Only tools registered on the server appear in a client's tool list; planned-but-unbuilt tools are never advertised.

export const PLANNED_TOOLS = [
  "verify_site",
  "verify_changed",
  "explain_finding",
  "list_checks",
  "get_config_schema",
  "create_baseline",
] as const;
