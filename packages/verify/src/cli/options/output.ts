// --format and --out: where the report goes and how it is rendered.

import { FORMATS, type Format } from "../../formats/index.js";
import { UsageError } from "../types.js";
import type { Options } from "./index.js";
import { value } from "./value.js";

export interface OutputOptions {
  format: Format;
  out: string | undefined;
}

export const OUTPUT_DEFAULTS: OutputOptions = { format: "pretty", out: undefined };

export const OUTPUT_FLAGS: readonly string[] = ["--format", "--out"];

export const OUTPUT_HELP = `  --format <format>    pretty (default), json, markdown, sarif, llm, prompt, or html.
                       prompt: one copy-pasteable prompt that fixes every finding,
                       grouped by file (fewest findings first), to work through in order.
                       html: one self-contained page for people, with severity, check, and file filters
  --out <file>         Write the report to a file; print a one-line summary instead
`;

export function parseOutput(options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number): number {
  const [v, next] = value(flag, inline, args, index);
  if (flag === "--format") {
    if (!(FORMATS as readonly string[]).includes(v)) throw new UsageError(`unknown format "${v}"; use ${FORMATS.join(", ")}`);
    options.format = v as Format;
  } else {
    options.out = v;
  }
  return next;
}
