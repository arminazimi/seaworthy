import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildConfig, buildReport, canonicalize, generatedFiles, jsonText, readGroup } from "./schema.mjs";

const make = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "schema-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
};

test("readGroup reads <key>.json and <key>.required.json, sorted by key", () => {
  const dir = make({ "b.required.json": '{"type":"string"}', "a.json": '{"const":0}' });
  assert.deepEqual(readGroup(dir), [
    { name: "a", required: false, schema: { const: 0 } },
    { name: "b", required: true, schema: { type: "string" } },
  ]);
});

test("readGroup rejects bad names and bodies, and reads an empty directory as no fragments", () => {
  assert.throws(() => readGroup(make({ "oops.md": "{}" })), /fragments are named/);
  assert.throws(() => readGroup(make({ ".json": "{}" })), /fragments are named/);
  assert.throws(() => readGroup(make({ "a.json": "not json" })), /invalid JSON/);
  assert.throws(() => readGroup(make({ "a.json": "[1]" })), /JSON object/);
  assert.deepEqual(readGroup(join(make({}), "absent")), []);
});

test("buildConfig assembles the skeleton with sorted properties and a sorted required list", () => {
  const dir = make({ "b.json": '{"type":"string"}', "a.json": '{"const":0}', "c.required.json": '{"type":"boolean"}' });
  const schema = buildConfig(readGroup(dir));
  assert.deepEqual(schema, {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
    title: "Seaworthy config",
    description: "seaworthy.config.json. spec 0 is a draft that changes without notice; it freezes with the report format at release.contract-freeze.",
    type: "object",
    additionalProperties: false,
    required: ["c"],
    properties: { a: { const: 0 }, b: { type: "string" }, c: { type: "boolean" } },
  });
  assert.deepEqual(Object.keys(schema), ["$schema", "$id", "title", "description", "type", "additionalProperties", "required", "properties"]);
});

test("a key cannot be both optional and required", () => {
  const dir = make({ "a.json": "{}", "a.required.json": "{}" });
  assert.throws(() => buildConfig(readGroup(dir)), /duplicate fragment/);
});

test("buildReport composes fields, the summary object, and $defs, and rejects a summary field fragment", () => {
  const fragments = {
    fields: readGroup(make({ "root.required.json": '{"type":"string"}', "prompt.json": '{"type":"string"}' })),
    summary: readGroup(make({ "pages.required.json": '{"type":"integer"}', "changedFiles.json": '{"type":"integer"}' })),
    defs: readGroup(make({ "finding.json": '{"type":"object"}' })),
  };
  const schema = buildReport(fragments);
  assert.deepEqual(schema.required, ["root", "summary"]);
  assert.deepEqual(schema.properties.summary, {
    type: "object",
    additionalProperties: false,
    required: ["pages"],
    properties: { changedFiles: { type: "integer" }, pages: { type: "integer" } },
  });
  assert.deepEqual(schema.$defs, { finding: { type: "object" } });
  assert.throws(
    () => buildReport({ fields: readGroup(make({ "summary.required.json": "{}" })), summary: [], defs: [] }),
    /assembled from fragments\/summary/,
  );
});

test("jsonText is 2-space JSON with LF and a trailing newline", () => {
  assert.equal(jsonText({ a: 1 }), '{\n  "a": 1\n}\n');
});

test("canonicalize sorts object keys and required lists, and no other array order", () => {
  assert.deepEqual(canonicalize({ b: 1, a: { required: ["z", "a"], enum: ["z", "a"], items: [{ x: 1, w: 2 }] } }), {
    a: { required: ["a", "z"], enum: ["z", "a"], items: [{ w: 2, x: 1 }] },
    b: 1,
  });
});

test("assembling the repo's own fragments reproduces the committed schemas", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const [rel, text] of generatedFiles(root)) {
    const committed = JSON.parse(readFileSync(join(root, rel), "utf8"));
    assert.deepEqual(canonicalize(JSON.parse(text)), canonicalize(committed), rel);
  }
});
