// --rendered and --network: which checks run beyond the plain, offline default.

import type { Options } from "./index.js";

export interface SelectorOptions {
  rendered: boolean;
  network: boolean;
}

export const SELECTOR_DEFAULTS: SelectorOptions = { rendered: false, network: false };

export const SELECTOR_FLAGS: readonly string[] = ["--rendered", "--network"];

export const SELECTOR_HELP = `  --rendered           Run checks that need a browser
  --network            Run checks that make network requests
`;

export function parseSelector(options: Options, flag: string, _inline: string | undefined, _args: readonly string[], index: number): number {
  if (flag === "--rendered") options.rendered = true;
  else options.network = true;
  return index;
}
