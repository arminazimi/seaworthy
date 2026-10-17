// Prints what Seaworthy currently reports for a fixture, in expected.json shape, for you to check by hand.
// Usage: node tools/fixture.mjs fixtures/broken/<name>
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { builtInChecks, parseConfig, verifySite } from "../packages/verify/dist/src/index.js";

const dir = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(join(dir, "site"))) {
  console.error("Usage: node tools/fixture.mjs fixtures/<clean|broken>/<name>   (needs a site/ folder; run `npm run build` first)");
  process.exit(2);
}
const settings = existsSync(join(dir, "fixture.json")) ? JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8")) : {};
const checks = settings.checks ? builtInChecks.filter((c) => settings.checks.includes(c.meta.id)) : builtInChecks;
const config = settings.config === undefined ? undefined : parseConfig(settings.config, "fixture.json", builtInChecks.map((c) => c.meta.id));
const { report } = await verifySite({ folder: join(dir, "site"), rootLabel: "site", checks, ...(config ? { config } : {}), now: new Date("2027-01-01T00:00:00Z") });
console.log(JSON.stringify({ description: "", findings: report.findings.map((f) => ({ check: f.checkId, file: f.location.file, ...(f.location.line ? { line: f.location.line } : {}), ...(f.location.column ? { column: f.location.column } : {}) })) }, null, 2));
