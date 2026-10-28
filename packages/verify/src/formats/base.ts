// Shared contracts for output formats. Every format module exports one `render`
// with this shape; the generated registry (registry.ts) collects them.
// To add a format: create formats/<id>.ts exporting `render`, then run `node tools/gen-registries.mjs`.

import type { Palette } from "../color.js";
import type { Report } from "../types.js";
import type { SarifContext } from "./sarif.js";

/** Extra input a format may need: SARIF reads site lines so edits become exact regions. */
export type FormatContext = SarifContext;

/** One output format. A module may ignore `context` or `paint`; the registry always passes both. */
export type Formatter = (report: Report, context: FormatContext, paint: Palette) => string;
