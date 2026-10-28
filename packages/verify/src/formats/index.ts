// Public surface for output formats. The wiring lives in the generated registry:
// each format module in this folder exports one `render`, and `node tools/gen-registries.mjs`
// regenerates registry.ts (the FORMATS tuple and the formatReport switch). To add a format,
// create formats/<id>.ts exporting `render`, run `npm run build`, then the generator.

export { FORMATS, formatReport } from "./registry.js";
export type { Format } from "./registry.js";
export type { FormatContext } from "./base.js";
