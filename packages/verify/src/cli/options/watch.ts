// --watch: verify again whenever the build folder changes.

import type { Options } from "./index.js";

export interface WatchOptions {
  watch: boolean;
}

export const WATCH_DEFAULTS: WatchOptions = { watch: false };

export const WATCH_FLAGS: readonly string[] = ["--watch"];

export const WATCH_HELP = `  --watch              Verify again whenever the build folder changes; after the first report, print only
                        what is new, fixed, and unchanged since the previous run. Ctrl-C to stop.
`;

export function parseWatch(options: Options, _flag: string, _inline: string | undefined, _args: readonly string[], index: number): number {
  options.watch = true;
  return index;
}
