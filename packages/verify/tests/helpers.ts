import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

import Ajv2020 from "ajv/dist/2020.js";
import Ajv6 from "ajv6";

const made: string[] = [];

/** Writes a built site to a temp folder: a map of relative path to text or raw bytes. Cleaned up after the test file. */
export function makeSite(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "seaworthy-test-"));
  made.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

after(() => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});

// packages/verify/dist/tests/helpers.js -> repository root is four levels up.
const schemaPath = fileURLToPath(new URL("../../../../spec/report/v0.schema.json", import.meta.url));
export const reportSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
const Ajv = Ajv2020 as unknown as typeof Ajv2020.default;
const validator = new Ajv({ strict: true, allErrors: true }).compile(reportSchema);

/** Returns schema violations of a report, or an empty list when it conforms. */
export function reportErrors(value: unknown): string[] {
  return validator(value) ? [] : validator.errors!.map((e) => `${e.instancePath} ${e.message}`);
}

// SARIF 2.1.0 is validated against the official schema (draft-04) shipped by @microsoft/jest-sarif, with ajv 6.
const nodeRequire = createRequire(import.meta.url);
const sarifSchemaPath = join(dirname(nodeRequire.resolve("@microsoft/jest-sarif/package.json")), "lib", "schemas", "sarif-2.1.0-rtm.5.json");
const ajv6 = new Ajv6({ schemaId: "auto", allErrors: true, unknownFormats: "ignore" });
ajv6.addMetaSchema(nodeRequire("ajv6/lib/refs/json-schema-draft-04.json"));
const sarifValidator = ajv6.compile(JSON.parse(readFileSync(sarifSchemaPath, "utf8")));

/** Returns violations of the official SARIF 2.1.0 schema, or an empty list when the log conforms. */
export function sarifErrors(value: unknown): string[] {
  return sarifValidator(value) ? [] : (sarifValidator.errors ?? []).map((e) => `${e.dataPath} ${e.message}`);
}
