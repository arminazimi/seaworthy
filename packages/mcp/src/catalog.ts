// The check catalog as an MCP resource: a client that wants to know which checks exist reads
// `seaworthy://checks` instead of calling a tool. The bytes come from `listChecks`, the same
// function the `list_checks` tool uses, so the tool and the resource can never disagree.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { CheckMeta } from "@seaworthy/verify";

import { listChecks } from "./list-checks.js";

/** The URI a client reads the catalog from. Part of the MCP surface; stable once released. */
export const CHECK_CATALOG_URI = "seaworthy://checks";

/** The resource name, as a client would see it in its resource list. */
export const CHECK_CATALOG_NAME = "check-catalog";

export const CHECK_CATALOG_DESCRIPTION =
  "The catalog of the built-in Seaworthy checks: id, title, default severity, what each check needs, its docs URL, and the standards it comes from. Read-only: it reads no site and produces no findings.";

/** The MIME type the catalog is served as. */
export const CHECK_CATALOG_MIME_TYPE = "application/json";

/** Registers the catalog resource on the server. */
export function registerCatalogResource(server: McpServer, checks: readonly CheckMeta[]): void {
  server.registerResource(
    CHECK_CATALOG_NAME,
    CHECK_CATALOG_URI,
    { description: CHECK_CATALOG_DESCRIPTION, mimeType: CHECK_CATALOG_MIME_TYPE },
    async (uri): Promise<ReadResourceResult> => ({
      contents: [{ uri: uri.href, mimeType: CHECK_CATALOG_MIME_TYPE, text: listChecks(checks) }],
    }),
  );
}
