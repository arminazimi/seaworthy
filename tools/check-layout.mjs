// Fails when the repository layout drifts from what AGENTS.md promises.
// Usage: node tools/check-layout.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const REQUIRED_FILES = [
  "README.md",
  "ROADMAP.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "LICENSE",
  ".github/workflows/ci.yml",
  ".github/pull_request_template.md",
];
const DOCUMENTED_DIRS = ["skills", "theme", "fixtures", "spec", "brand", "docs/adr", "planning/roadmap"];

for (const file of REQUIRED_FILES) {
  if (!existsSync(join(root, file))) errors.push(`missing ${file}`);
}
for (const dir of DOCUMENTED_DIRS) {
  if (!existsSync(join(root, dir, "README.md"))) errors.push(`${dir}/ needs a README.md that says what belongs there`);
}

const license = existsSync(join(root, "LICENSE")) ? readFileSync(join(root, "LICENSE"), "utf8") : "";
if (!license.includes("Apache License") || !license.includes("Version 2.0")) errors.push("LICENSE must be Apache-2.0");

const packages = readdirSync(join(root, "packages"), { withFileTypes: true }).filter((d) => d.isDirectory());
for (const dir of packages) {
  const path = join(root, "packages", dir.name, "package.json");
  if (!existsSync(path)) {
    errors.push(`packages/${dir.name} has no package.json`);
    continue;
  }
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  if (pkg.license !== "Apache-2.0") errors.push(`${pkg.name}: license must be Apache-2.0`);
  if (!pkg.name?.startsWith("@seaworthy/")) errors.push(`packages/${dir.name}: name must use the @seaworthy/ scope`);
  if (pkg.engines?.node !== ">=22") errors.push(`${pkg.name}: engines.node must be ">=22"`);
}

if (errors.length) {
  console.error(errors.map((e) => `layout: ${e}`).join("\n"));
  process.exit(1);
}
console.log(`OK: layout (${REQUIRED_FILES.length} files, ${DOCUMENTED_DIRS.length} documented folders, ${packages.length} packages)`);
