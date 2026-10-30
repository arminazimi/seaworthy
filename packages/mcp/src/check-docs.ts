// The check docs pages as MCP resources: every check's contract page at docs/checks/<id>.md is
// readable by a client as a resource, so an agent can pull the full page rather than only the
// excerpt `explain_finding` quotes. This package is a thin adapter over the verify API (AGENTS.md)
// and owns no check logic: the check ids and titles it lists come from verify's own check
// metadata — the same source `list_checks` and `explain_finding` use, and the same docs folder
// `explain_finding` reads — and the page text is returned verbatim.
//
// Docs pages are untrusted prose: they are read and returned as text, never parsed, evaluated, or
// acted on. Nothing here touches the network, a site, or the clock, so `resources/list` is the
// same list on every call and on every platform.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import { builtInChecks, validateCheckId } from "@seaworthy/verify";
import type { Check } from "@seaworthy/verify";

import { DEFAULT_DOCS_DIR } from "./explain-finding.js";

/** Resource template name, as a client sees it in `resources/templates/list`. Part of the MCP surface; stable once released. */
export const CHECK_DOCS_RESOURCE_NAME = "check_docs";

/** The URI template of the check docs resources. One variable: the check id, as the registry spells it. */
export const CHECK_DOCS_URI_TEMPLATE = "seaworthy://checks/{check_id}/docs";

/** Every docs page is Markdown text, served with this MIME type. */
export const CHECK_DOCS_MIME_TYPE = "text/markdown";

/** The template's own title and description, shared by every page it serves. */
export const CHECK_DOCS_RESOURCE_TITLE = "Seaworthy check docs";
export const CHECK_DOCS_RESOURCE_DESCRIPTION =
  "The contract page of one Seaworthy check, as Markdown text: what it reports, when it fails, how to fix it, and the standards behind it. One resource per check the server knows, at seaworthy://checks/<check-id>/docs.";

/** What the resources read. `checks` is the same list the tools run and `list_checks` publishes. */
export interface CheckDocsOptions {
  /** The checks whose docs pages are served. Default: verify's built-in checks. */
  readonly checks?: readonly Check[];
  /** The folder of check contract pages. Default: this repository's `docs/checks`. */
  readonly docsDir?: string;
}

/** One entry of `resources/list`: a check's docs page at its URI. */
export interface CheckDocsResource {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
}

/** The URI of one check's docs resource — the same shape the template expands to. */
export function checkDocsUri(checkId: string): string {
  return `seaworthy://checks/${checkId}/docs`;
}

// Sorted by check ID, the same order `list_checks` publishes; the URI's trailing path would sort a
// dotted id after its own hyphenated sibling, so the id — not the URI — is the key.
const byId = (a: CheckDocsResource, b: CheckDocsResource): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The docs pages this server serves, one per check it knows, sorted by check ID. Derived from
 * check metadata only, so no id is invented and no page on disk can sneak into the list.
 */
export function listCheckDocsResources(options: CheckDocsOptions = {}): readonly CheckDocsResource[] {
  const checks: readonly Check[] = options.checks ?? builtInChecks;
  return checks
    .map((check): CheckDocsResource => ({ uri: checkDocsUri(check.meta.id), name: check.meta.id, title: check.meta.title }))
    .sort(byId);
}

/**
 * Reads one check's docs page as a `resources/read` result, the file returned verbatim.
 * An id the registry does not know is rejected before any path is built, so a client cannot
 * address a file this server does not serve; a page this install does not ship answers with the
 * docs URL verify publishes for that check.
 */
export function readCheckDocs(checkId: string, uri: string, options: CheckDocsOptions = {}): ReadResourceResult {
  const checks: readonly Check[] = options.checks ?? builtInChecks;
  const meta = checks.find((check) => check.meta.id === checkId)?.meta;
  if (meta === undefined) {
    throw new McpError(ErrorCode.InvalidParams, `unknown check id "${checkId}"; the check docs resources only serve checks that exist — list_checks lists them`);
  }
  // Only ever an id the registry knows does a docs path get built, and the report contract's own
  // ID pattern rejects separators, so a client-supplied id can never address another file.
  validateCheckId(meta.id);
  let text: string;
  try {
    text = readFileSync(join(options.docsDir ?? DEFAULT_DOCS_DIR, `${meta.id}.md`), "utf8");
  } catch {
    throw new McpError(ErrorCode.InternalError, `the docs page of check "${meta.id}" is not shipped with this install; it is published at ${meta.docs}`);
  }
  return { contents: [{ uri, mimeType: CHECK_DOCS_MIME_TYPE, text }] };
}

/**
 * Registers the check docs resources on a server, before it connects: one URI template that lists
 * every check's page and reads it as Markdown text. Registered as a template rather than one
 * static resource per check so the list follows the checks a caller injected, with no fixed table
 * of URIs to keep in step with the registry.
 */
export function registerCheckDocsResources(server: McpServer, options: CheckDocsOptions = {}): void {
  const readOptions: CheckDocsOptions = {
    checks: options.checks ?? builtInChecks,
    docsDir: options.docsDir ?? DEFAULT_DOCS_DIR,
  };
  server.registerResource(
    CHECK_DOCS_RESOURCE_NAME,
    // The SDK's list result holds a mutable array, so the sorted list is copied out of the readonly one.
    new ResourceTemplate(CHECK_DOCS_URI_TEMPLATE, { list: () => ({ resources: [...listCheckDocsResources(readOptions)] }) }),
    { title: CHECK_DOCS_RESOURCE_TITLE, description: CHECK_DOCS_RESOURCE_DESCRIPTION, mimeType: CHECK_DOCS_MIME_TYPE },
    (uri, variables): ReadResourceResult => {
      const checkId = variables["check_id"];
      if (typeof checkId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, `the check docs resource needs one check id in ${CHECK_DOCS_URI_TEMPLATE}, got ${JSON.stringify(checkId)}`);
      }
      return readCheckDocs(checkId, uri.toString(), readOptions);
    },
  );
}
