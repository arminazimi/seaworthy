// Shared contracts for output formats. Every format module exports one `render`
// with this shape; the generated registry (registry.ts) collects them.
// To add a format: create formats/<id>.ts exporting `render`, then run `node tools/gen-registries.mjs`.

import type { Palette } from "../color.js";
import type { HistoryRecord } from "../history.js";
import type { Report } from "../types.js";
import type { SarifContext } from "./sarif.js";

/**
 * Extra input a format may need: SARIF reads site lines so edits become exact regions, and the
 * HTML report reads the run history to draw a trend. Both are optional, so a format that needs
 * neither ignores `context` entirely; the CLI supplies them only for the formats that ask.
 */
export type FormatContext = SarifContext & {
  /** The stored runs to show in the trend, oldest first (from `readHistory`). Absent: no trend. */
  history?: readonly HistoryRecord[];
};

/** One output format. A module may ignore `context` or `paint`; the registry always passes both. */
export type Formatter = (report: Report, context: FormatContext, paint: Palette) => string;
