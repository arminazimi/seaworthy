// Unit tests for the check docs resources: what `resources/list` serves, what one read returns,
// and the errors an unknown check id or an unshipped page answers with. Everything runs offline
// against check metadata and this repository's docs pages — no site, no network, no CLI process.
// The wire behavior over stdio is server.e2e.test.ts.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { builtInChecks } from "@seaworthy/verify";
import type { Check } from "@seaworthy/verify";

import {
  CHECK_DOCS_MIME_TYPE,
  CHECK_DOCS_RESOURCE_DESCRIPTION,
  CHECK_DOCS_URI_TEMPLATE,
  checkDocsUri,
  listCheckDocsResources,
  readCheckDocs,
  registerCheckDocsResources,
} from "../src/check-docs.js";
import { DEFAULT_DOCS_DIR } from "../src/explain-finding.js";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A docs folder with the given pages, cleaned up after the test file. */
function docsWorkspace(pages: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "seaworthy-mcp-docs-"));
  made.push(dir);
  for (const [name, content] of Object.entries(pages)) writeFileSync(join(dir, name), content);
  return dir;
}

/** One check, so the served list follows the checks a caller injected rather than the built-ins. */
const customCheck: Check = {
  meta: { id: "custom.rule", title: "A custom rule", severity: "note", needs: ["html"], docs: "https://example.test/docs/custom.rule.md", standards: [] },
  run: () => [],
};

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The text of the one content item a read returned, narrowed from the contract's text-or-blob union. */
function textOf(result: ReadResourceResult): string {
  const content = result.contents[0];
  assert.ok(content !== undefined && "text" in content, "a docs page is served as text, never as a base64 blob");
  return content.text;
}

test("the docs resources serve one page per check the server knows, sorted by check id", () => {
  const expected = [...builtInChecks].map((check) => check.meta).sort(byId);
  const listed = listCheckDocsResources();
  assert.equal(listed.length, builtInChecks.length, "every check the server knows is served, none invented");
  assert.deepEqual(
    listed.map((resource) => resource.name),
    expected.map((meta) => meta.id),
  );
  assert.deepEqual(
    listed.map((resource) => resource.uri),
    expected.map((meta) => checkDocsUri(meta.id)),
  );
  assert.deepEqual(
    listed.map((resource) => resource.title),
    expected.map((meta) => meta.title),
    "the display title is verify's own check title",
  );
  assert.equal(new Set(listed.map((resource) => resource.uri)).size, listed.length, "URIs are unique");
  for (const resource of listed) assert.deepEqual(Object.keys(resource), ["uri", "name", "title"]);
});

test("the docs resources follow the injected checks, like every other surface here", () => {
  assert.deepEqual(listCheckDocsResources({ checks: [customCheck] }), [
    { uri: "seaworthy://checks/custom.rule/docs", name: "custom.rule", title: "A custom rule" },
  ]);
});

test("reading a check's resource returns its docs page verbatim as Markdown text", () => {
  const docsDir = docsWorkspace({ "custom.rule.md": "# custom.rule\n\nHow to fix it.\n" });
  const result = readCheckDocs("custom.rule", checkDocsUri("custom.rule"), { checks: [customCheck], docsDir });
  assert.deepEqual(Object.keys(result), ["contents"]);
  assert.deepEqual(Object.keys(result.contents[0]!), ["uri", "mimeType", "text"]);
  assert.equal(textOf(result), "# custom.rule\n\nHow to fix it.\n", "the page arrives as it is on disk");
  assert.deepEqual(result.contents, [
    { uri: "seaworthy://checks/custom.rule/docs", mimeType: "text/markdown", text: "# custom.rule\n\nHow to fix it.\n" },
  ]);
});

test("reading the real docs pages answers every built-in check with its own page", () => {
  for (const check of builtInChecks) {
    const result = readCheckDocs(check.meta.id, checkDocsUri(check.meta.id));
    assert.equal(result.contents[0]!.mimeType, CHECK_DOCS_MIME_TYPE, `${check.meta.id} is served as Markdown`);
    assert.equal(
      textOf(result),
      readFileSync(join(DEFAULT_DOCS_DIR, `${check.meta.id}.md`), "utf8"),
      `${check.meta.id} returns the page as it is, with nothing added or re-flowed`,
    );
  }
});

test("an unknown check id is rejected before any file is read", () => {
  // A client cannot address a file the registry does not serve: not by an invented id, not by a path.
  const docsDir = docsWorkspace({ "secret.md": "nope\n" });
  for (const id of ["no.such.check", "../../secret", "images.alt/../README"]) {
    assert.throws(
      () => readCheckDocs(id, checkDocsUri(id), { docsDir }),
      (error: unknown) => {
        assert.equal((error as { code?: number }).code, ErrorCode.InvalidParams, `${id} is an invalid parameter, not a server failure`);
        assert.match((error as Error).message, /unknown check id/);
        return true;
      },
    );
  }
});

test("a page this install does not ship answers with the check's own published docs URL", () => {
  const meta = builtInChecks.find((check) => check.meta.id === "images.alt")!.meta;
  assert.throws(
    () => readCheckDocs("images.alt", checkDocsUri("images.alt"), { docsDir: "/nonexistent/seaworthy-docs" }),
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, ErrorCode.InternalError, "an install without docs pages is the server's problem, not the client's");
      assert.match((error as Error).message, new RegExp(meta.docs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    },
  );
});

test("a registered server serves the resources over the MCP surface: list, read, and a clean error", async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCheckDocsResources(server, { checks: [customCheck], docsDir: docsWorkspace({ "custom.rule.md": "# custom.rule\n\nFixed this way.\n" }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "in-memory-client", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listResources();
    assert.equal(listed.resources.length, 1, "one template, one page, exactly the injected check");
    assert.deepEqual(listed.resources, [
      {
        uri: CHECK_DOCS_URI_TEMPLATE.replace("{check_id}", "custom.rule"),
        name: "custom.rule",
        title: "A custom rule",
        description: CHECK_DOCS_RESOURCE_DESCRIPTION,
        mimeType: CHECK_DOCS_MIME_TYPE,
      },
    ]);

    const read = await client.readResource({ uri: "seaworthy://checks/custom.rule/docs" });
    assert.deepEqual(read.contents, [{ uri: "seaworthy://checks/custom.rule/docs", mimeType: "text/markdown", text: "# custom.rule\n\nFixed this way.\n" }]);

    await assert.rejects(
      () => client.readResource({ uri: "seaworthy://checks/no.such.check/docs" }),
      (error: unknown) => {
        assert.equal((error as { code?: number }).code, ErrorCode.InvalidParams);
        assert.match((error as Error).message, /unknown check id "no\.such\.check"/);
        return true;
      },
    );
  } finally {
    await client.close();
    await server.close();
  }
});
