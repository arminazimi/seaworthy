// Generates every SVG brand asset from tools/brand/mark.mjs and brand/tokens.json.
//
//   node tools/brand/build.mjs           # write brand/assets, brand/templates, tokens.css, presets
//   node tools/brand/build.mjs --check   # fail if any generated file is missing or out of date
//
// PNG exports are separate (tools/brand/export.mjs) because they need a browser.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { badgeSvg } from "./badge.mjs";
import { BRAND_DIR, VARIANTS, faviconSvg, markSvg, tokensCss } from "./mark.mjs";
import { EXPORT_PRESETS_JSON, FAVICON_OUTPUTS, TEMPLATE_FILES, logoSheet } from "./templates.mjs";

export function generatedFiles() {
  const files = new Map();
  for (const variant of Object.keys(VARIANTS)) files.set(`assets/seaworthy-mark-${variant}.svg`, markSvg(variant));
  files.set("favicon/favicon.svg", faviconSvg({ rounded: true }));
  files.set("favicon/icon-square.svg", faviconSvg({ rounded: false }));
  files.set("assets/badge-passing.svg", badgeSvg("passing"));
  files.set("assets/badge-warnings.svg", badgeSvg("warnings", 3));
  files.set("assets/badge-failing.svg", badgeSvg("failing", 12));
  for (const { file, svg } of TEMPLATE_FILES) files.set(file, svg);
  files.set("seaworthy-logo-sheet.svg", logoSheet());
  files.set("tokens.css", tokensCss());
  files.set("export-presets.json", JSON.stringify(EXPORT_PRESETS_JSON, null, 2) + "\n");
  return files;
}

function main() {
  const check = process.argv.includes("--check");
  const files = generatedFiles();
  const problems = [];
  for (const [rel, content] of files) {
    const path = join(BRAND_DIR, rel);
    if (check) {
      if (!existsSync(path)) problems.push(`missing brand/${rel}`);
      else if (readFileSync(path, "utf8") !== content) problems.push(`brand/${rel} is out of date`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  if (check) {
    const presets = EXPORT_PRESETS_JSON.presets;
    for (const p of presets) if (!existsSync(join(BRAND_DIR, p.output))) problems.push(`missing brand/${p.output} (run npm run export:brand)`);
    for (const f of FAVICON_OUTPUTS) if (!existsSync(join(BRAND_DIR, f))) problems.push(`missing brand/${f} (run npm run export:brand)`);
    if (problems.length) {
      console.error(problems.map((p) => `brand: ${p}`).join("\n"));
      console.error("brand: regenerate with `npm run build:brand` and `npm run export:brand`");
      process.exit(1);
    }
    console.log(`OK: brand (${files.size} generated files in sync, ${presets.length} PNG exports present)`);
    return;
  }
  console.log(`Wrote ${files.size} files under brand/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
