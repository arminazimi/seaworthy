// Assembles the versioned schemas in spec/ from per-feature fragments, so parallel PRs add a file
// instead of editing the same lines.
//
//   node tools/schema.mjs           # rewrite spec/config/v0.schema.json and spec/report/v0.schema.json
//   node tools/schema.mjs --check   # fail if a built schema is missing or out of date
//
// A fragment is one JSON file holding the schema of one config option, report field, or $defs entry,
// named for the feature it belongs to (see spec/*/fragments/README.md). A ".required" suffix before
// ".json" adds the key to the parent's required list. Output is deterministic across platforms:
// keys sorted byte-wise, 2-space JSON, LF, trailing newline.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONFIG_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/config/v0.schema.json",
  title: "Seaworthy config",
  description: "seaworthy.config.json. spec 0 is a draft that changes without notice; it freezes with the report format at release.contract-freeze.",
};

const REPORT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://raw.githubusercontent.com/arminazimi/seaworthy/main/spec/report/v0.schema.json",
  title: "Seaworthy report",
  description: "The report `seaworthy verify --format json` emits. spec 0 is a draft that changes without notice; it freezes as spec 1 at release.contract-freeze.",
};

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Reads one fragment directory as [{ name, required, schema }], sorted by name byte-wise.
 * `<key>.json` is optional; `<key>.required.json` also lists the key in the parent's required array. */
export function readGroup(dir) {
  if (!existsSync(dir)) return [];
  const parts = [];
  for (const file of readdirSync(dir).sort(byCodeUnit)) {
    if (file === "README.md") continue;
    const suffix = file.endsWith(".required.json") ? ".required.json" : ".json";
    const name = file.endsWith(suffix) ? file.slice(0, -suffix.length) : "";
    if (name === "") throw new Error(`${dir}/${file}: fragments are named <key>.json or <key>.required.json`);
    let schema;
    try {
      schema = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`${dir}/${file}: invalid JSON (${error.message})`);
    }
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) throw new Error(`${dir}/${file}: must be a JSON object holding one property or $defs schema`);
    parts.push({ name, required: suffix === ".required.json", schema });
  }
  return parts;
}

/** Reads every fragment group under spec/. */
export function readFragments(root) {
  return {
    config: readGroup(join(root, "spec", "config", "fragments")),
    fields: readGroup(join(root, "spec", "report", "fragments", "fields")),
    summary: readGroup(join(root, "spec", "report", "fragments", "summary")),
    defs: readGroup(join(root, "spec", "report", "fragments", "defs")),
  };
}

/** One object schema from a fragment group: properties keyed by fragment, required from the *.required names. */
function objectFrom(parts) {
  const object = { type: "object", additionalProperties: false };
  const properties = {};
  const required = [];
  for (const { name, required: isRequired, schema } of [...parts].sort((a, b) => byCodeUnit(a.name, b.name))) {
    if (name in properties) throw new Error(`duplicate fragment for ${name}`);
    properties[name] = schema;
    if (isRequired) required.push(name);
  }
  if (required.length > 0) object.required = required;
  object.properties = properties;
  return object;
}

export function buildConfig(fragments) {
  return { ...CONFIG_SCHEMA, ...objectFrom(fragments) };
}

export function buildReport({ fields, summary, defs }) {
  if (fields.some((f) => f.name === "summary")) throw new Error("report fragments/fields must not define summary; it is assembled from fragments/summary/");
  const summaryField = { name: "summary", required: summary.length > 0, schema: objectFrom(summary) };
  const report = { ...REPORT_SCHEMA, ...objectFrom([...fields, summaryField]), $defs: {} };
  for (const { name, schema } of defs) {
    if (name in report.$defs) throw new Error(`duplicate $defs fragment for ${name}`);
    report.$defs[name] = schema;
  }
  return report;
}

/** Stable JSON text of a schema, ending in a newline. */
export function jsonText(schema) {
  return JSON.stringify(schema, null, 2) + "\n";
}

/** Builds both schema files as { path relative to the repo root -> text }. */
export function generatedFiles(root, fragments = readFragments(root)) {
  return new Map([
    ["spec/config/v0.schema.json", jsonText(buildConfig(fragments.config))],
    ["spec/report/v0.schema.json", jsonText(buildReport(fragments))],
  ]);
}

/** Deep copy with object keys and `required` arrays sorted — the two orders JSON Schema does not care about.
 * Every other array keeps its order, so a comparison of two canonicalized schemas is a semantic comparison. */
export function canonicalize(value, key) {
  if (Array.isArray(value)) return (key === "required" ? [...value].sort(byCodeUnit) : value).map((v) => canonicalize(v));
  if (typeof value === "object" && value !== null) {
    const out = {};
    for (const k of Object.keys(value).sort(byCodeUnit)) out[k] = canonicalize(value[k], k);
    return out;
  }
  return value;
}

function main() {
  const check = process.argv.includes("--check");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fragments = readFragments(root);
  const files = generatedFiles(root, fragments);
  const count = fragments.config.length + fragments.fields.length + fragments.summary.length + fragments.defs.length;
  const problems = [];
  for (const [rel, content] of files) {
    const path = join(root, rel);
    if (check) {
      if (!existsSync(path)) problems.push(`missing ${rel}`);
      else if (readFileSync(path, "utf8") !== content) problems.push(`${rel} is out of date`);
      continue;
    }
    writeFileSync(path, content);
  }
  if (problems.length) {
    console.error(problems.map((p) => `schema: ${p}`).join("\n"));
    console.error("schema: regenerate with `npm run schema:build`");
    process.exit(1);
  }
  console.log(check ? `OK: schema (${files.size} built schemas in sync, ${count} fragments)` : `Wrote ${files.size} schemas from ${count} fragments under spec/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
