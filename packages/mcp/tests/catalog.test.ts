// Unit tests for the check catalog resource: a client that reads `seaworthy://checks` and a client
// that calls `list_checks` must see the same catalog, byte for byte. The client and the server
// talk over the SDK's in-memory transport, so no process is spawned.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { builtInChecks, REPORT_SPEC_VERSION } from "@seaworthy/verify";

import { CHECK_CATALOG_MIME_TYPE, CHECK_CATALOG_NAME, CHECK_CATALOG_URI } from "../src/catalog.js";
import { createServer } from "../src/server.js";

/** The server and a client on it, connected over an in-memory transport. */
async function connected(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "node:test/mcp-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test("the catalog resource and the list_checks tool serve the same bytes", async () => {
  const client = await connected();
  const resource = await client.readResource({ uri: CHECK_CATALOG_URI });
  const tool = await client.callTool({ name: "list_checks", arguments: {} });
  const resourceText = resource.contents[0]!;
  assert.equal(resourceText.uri, CHECK_CATALOG_URI);
  assert.equal(resourceText.mimeType, CHECK_CATALOG_MIME_TYPE);
  assert.ok("text" in resourceText, "the catalog is served as text");
  const toolText = (tool.content as Array<{ type: string; text: string }>)[0]!.text;
  assert.equal(resourceText.text, toolText, "the tool and the resource cannot disagree");
});

test("the catalog lists every built-in check, sorted by id", async () => {
  const client = await connected();
  const resource = await client.readResource({ uri: CHECK_CATALOG_URI });
  const contents = resource.contents[0]!;
  assert.ok("text" in contents);
  const catalog = JSON.parse(contents.text) as { spec: number; checks: Array<{ id: string }> };
  assert.equal(catalog.spec, REPORT_SPEC_VERSION);
  assert.equal(catalog.checks.length, builtInChecks.length);
  assert.deepEqual(
    catalog.checks.map((check) => check.id),
    [...builtInChecks].map((check) => check.meta.id).sort(),
    "the catalog is sorted by check id",
  );
});

test("the server advertises the catalog resource", async () => {
  const client = await connected();
  const listed = await client.listResources();
  assert.deepEqual(listed.resources, [
    {
      uri: CHECK_CATALOG_URI,
      name: CHECK_CATALOG_NAME,
      description: "The catalog of the built-in Seaworthy checks: id, title, default severity, what each check needs, its docs URL, and the standards it comes from. Read-only: it reads no site and produces no findings.",
      mimeType: CHECK_CATALOG_MIME_TYPE,
    },
  ]);
});
