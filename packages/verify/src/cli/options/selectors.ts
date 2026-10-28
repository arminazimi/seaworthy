// --rendered, --browser-path, and --network: which checks run beyond the plain, offline
// default, and which browser the rendered ones launch.

import type { Options } from "./index.js";
import { value } from "./value.js";

export interface SelectorOptions {
  rendered: boolean;
  browserPath: string | undefined;
  network: boolean;
}

export const SELECTOR_DEFAULTS: SelectorOptions = { rendered: false, browserPath: undefined, network: false };

export const SELECTOR_FLAGS: readonly string[] = ["--rendered", "--browser-path", "--network"];

export const SELECTOR_HELP = `  --rendered           Run checks that need a browser
  --browser-path <path>
                       Browser executable for --rendered. Default: SEAWORTHY_BROWSER,
                       then an installed Chrome, Chromium, or Edge
  --network            Run checks that make network requests
`;

export function parseSelector(options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number): number {
  if (flag === "--rendered") {
    options.rendered = true;
    return index;
  }
  if (flag === "--network") {
    options.network = true;
    return index;
  }
  const [v, next] = value(flag, inline, args, index);
  options.browserPath = v;
  return next;
}
