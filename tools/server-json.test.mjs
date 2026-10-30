// Guards packages/mcp/server.json — the MCP Registry entry (issue #81).
//
// The registry consumes this file to install a server, so the fields that matter are the ones a
// consumer runs with: the server name, the version, the package identifier and the transport. Each
// is asserted against what this repository already says elsewhere (package.json, the server's own
// source), so the entry cannot drift from the server it describes.
//
// Offline by design: `npm test` needs no network. The rules restated here are the registry's own,
// from https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json and
// docs/reference/server-json/official-registry-requirements.md in modelcontextprotocol/registry.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_JSON = join(root, "packages", "mcp", "server.json");
const text = readFileSync(SERVER_JSON, "utf8");
const server = JSON.parse(text);
const pkg = JSON.parse(readFileSync(join(root, "packages", "mcp", "package.json"), "utf8"));
const source = {
  server: readFileSync(join(root, "packages", "mcp", "src", "server.ts"), "utf8"),
};

/** The registry's `name` pattern: a namespace and a server name, split by exactly one slash. */
const NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const npmEntry = server.packages[0];

const tsFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });

test("server.json is 2-space JSON with a trailing newline, like every generated file here", () => {
  assert.equal(text, `${JSON.stringify(server, null, 2)}\n`);
});

test("server.json has the registry's required fields in the shapes it validates", () => {
  assert.equal(server.$schema, SCHEMA_URL);
  for (const key of ["name", "description", "version"]) assert.equal(typeof server[key], "string", `${key} is required by the registry`);
  assert.match(server.name, NAME_PATTERN);
  assert.equal(server.name.split("/").length, 2, "the registry wants exactly one slash");
  assert.ok(server.description.length >= 1 && server.description.length <= 100, `description is ${server.description.length} characters; the registry allows at most 100`);
  assert.equal(typeof server.title, "string");
  assert.ok(server.title.length <= 100);
  // Version ranges are rejected by the registry; a specific version is required.
  assert.doesNotMatch(server.version, /[\^~><*x]/);
});

test("the version is this package's version, not an invented one", () => {
  assert.equal(server.version, pkg.version);
  assert.equal(npmEntry.version, pkg.version);
});

test("the server name and title match the MCP handshake the server reports", () => {
  const handshakeName = /export const SERVER_NAME = "([^"]+)"/.exec(source.server)?.[1];
  const handshakeTitle = /export const SERVER_TITLE = "([^"]+)"/.exec(source.server)?.[1];
  assert.ok(handshakeName && handshakeTitle, "server.ts must declare SERVER_NAME and SERVER_TITLE");
  assert.equal(server.name.split("/")[1], handshakeName);
  assert.equal(server.title, handshakeTitle);
});

test("the npm entry names this package, and the registry's ownership pairing holds", () => {
  assert.equal(npmEntry.registryType, "npm");
  // The official registry accepts only these base URLs for npm packages.
  assert.equal(npmEntry.registryBaseUrl, "https://registry.npmjs.org");
  assert.equal(npmEntry.identifier, pkg.name);
  // Ownership verification: mcpName in the published package.json must equal the registry name.
  assert.equal(pkg.mcpName, server.name);
});

test("the transport is the stdio one the server actually connects, and no remote is claimed", () => {
  assert.equal(npmEntry.transport.type, "stdio");
  assert.match(source.server, /StdioServerTransport/);
  assert.equal(server.remotes, undefined, "the server offers no hosted endpoint yet, so none may be declared");
});

test("npx is launchable as declared: a runtime hint needs a bin, and undeclared flags stay absent", () => {
  assert.equal(npmEntry.runtimeHint, "npx");
  assert.ok(Object.keys(pkg.bin ?? {}).length >= 1, "runtimeHint npx needs a bin for npx to run");
  // main.ts reads no flags, so nothing may be passed; a new flag means a packageArguments entry.
  assert.equal(npmEntry.packageArguments, undefined);
  assert.equal(npmEntry.runtimeArguments, undefined);
});

test("every declared environment variable is one the code really reads", () => {
  const readable = [...tsFiles(join(root, "packages", "mcp", "src")), ...tsFiles(join(root, "packages", "verify", "src"))]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  for (const entry of npmEntry.environmentVariables ?? []) {
    const read = readable.includes(`process.env["${entry.name}"]`) || readable.includes(`process.env.${entry.name}`);
    assert.ok(read, `${entry.name} is declared but never read`);
    assert.equal(entry.value, undefined, "a shipped default would override what the user configures");
    assert.equal(entry.isSecret, false);
  }
});

test("nothing is claimed that this repository cannot prove yet", () => {
  // An unpublished package has no hash to publish, and no hosted icon URL to point at.
  assert.equal(npmEntry.fileSha256, undefined);
  assert.equal(server.icons, undefined);
  assert.equal(server.websiteUrl, undefined, "there is no project site to name yet");
  const meta = server._meta?.["io.modelcontextprotocol.registry/publisher-provided"];
  assert.equal(meta.publishedOnNpm, false);
  assert.equal(pkg.private, true, "the package is still private, so the _meta note may not claim it is published");
});
