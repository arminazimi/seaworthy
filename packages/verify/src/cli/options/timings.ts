// --timings: opt-in stage and check wall times on stderr; the report is unchanged.

import type { Options } from "./index.js";

export interface TimingsOptions {
  timings: boolean;
}

export const TIMINGS_DEFAULTS: TimingsOptions = { timings: false };

export const TIMINGS_FLAGS: readonly string[] = ["--timings"];

export const TIMINGS_HELP = `  --timings            Time each stage and check, printed to stderr; the report is unchanged
`;

export function parseTimings(options: Options, _flag: string, _inline: string | undefined, _args: readonly string[], index: number): number {
  options.timings = true;
  return index;
}
