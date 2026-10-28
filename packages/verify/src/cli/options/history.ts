// --no-history: the per-run opt-out of recording the run in .seaworthy/history.

import type { Options } from "./index.js";

export interface HistoryOptions {
  /** Record the run in .seaworthy/history. Default on; `--no-history` is the per-run opt-out. */
  history: boolean;
}

export const HISTORY_DEFAULTS: HistoryOptions = { history: true };

export const HISTORY_FLAGS: readonly string[] = ["--no-history"];

export const HISTORY_HELP = `  --no-history         Do not record this run in .seaworthy/history (default on; also "history": false in the config)
`;

export function parseHistory(options: Options, _flag: string, _inline: string | undefined, _args: readonly string[], index: number): number {
  options.history = false;
  return index;
}
