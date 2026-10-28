import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { parseConfig } from "../src/config.js";

const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../spec/config/v0.schema.json", import.meta.url)), "utf8"));
const Ajv = Ajv2020 as unknown as typeof Ajv2020.default;
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
const IDS = ["links.internal", "images.alt", "a11y.color-contrast"];

const valid = [
  {},
  { root: "dist", failOn: "none", rendered: true, network: false, history: false, baseline: "b.json", ignore: ["drafts/**"] },
  { checks: { "links.internal": "warning", "images.alt": "off", "a11y.*": { severity: "note", options: { x: 1 } }, "a11y.color-contrast": { off: false } } },
  { checks: { "links.internal": { maxFindings: 20 }, "images.*": { maxFindings: 5, severity: "warning" } } },
  { suppressions: [{ check: "links.internal", file: "blog/**", reason: "archive", expires: "2027-03-01" }, { check: "images.alt", fingerprint: "d6062a0613274944", reason: "decorative" }] },
];
const invalid = [
  { failOn: "fatal" },
  { chekcs: {} },
  { rendered: "yes" },
  { history: "yes" },
  { ignore: "drafts" },
  { checks: { Links: "off" } },
  { checks: { "links.internal": "critical" } },
  { checks: { "links.internal": { sevrity: "note" } } },
  { checks: { "links.internal": { maxFindings: 0 } } },
  { checks: { "links.internal": { maxFindings: 2.5 } } },
  { checks: { "links.internal": { maxFindings: "many" } } },
  { suppressions: [{ check: "links.internal", reason: "no target" }] },
  { suppressions: [{ check: "links.internal", file: "a.html" }] },
  { suppressions: [{ check: "links.internal", file: "a.html", reason: "ok then", expires: "soon" }] },
];

test("the published schema and the parser agree on valid configs", () => {
  for (const config of valid) {
    assert.ok(validate(config), JSON.stringify(config) + " " + JSON.stringify(validate.errors));
    assert.doesNotThrow(() => parseConfig(config, "c.json", IDS), JSON.stringify(config));
  }
});

test("the published schema and the parser agree on invalid configs", () => {
  for (const config of invalid) {
    assert.equal(validate(config), false, `schema should reject ${JSON.stringify(config)}`);
    assert.throws(() => parseConfig(config, "c.json", IDS), `parser should reject ${JSON.stringify(config)}`);
  }
});
