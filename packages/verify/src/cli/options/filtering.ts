// --config, --baseline, --update-baseline, --changed, --changed-since: what the run reads
// its settings from and which findings it keeps — accepted baselines and change filters.

import type { Options } from "./index.js";
import { value } from "./value.js";

export interface FilteringOptions {
  config: string | undefined;
  baseline: string | undefined;
  updateBaseline: string | undefined;
  changed: boolean;
  changedSince: string | undefined;
}

export const FILTERING_DEFAULTS: FilteringOptions = { config: undefined, baseline: undefined, updateBaseline: undefined, changed: false, changedSince: undefined };

export const FILTERING_FLAGS: readonly string[] = ["--config", "--baseline", "--update-baseline", "--changed", "--changed-since"];

export const FILTERING_HELP = `  --config <file>      Config file. Default: seaworthy.config.json in the current folder, if present
  --baseline <file>    Accept the findings recorded in this file; report and fail only on new ones
  --update-baseline <file>
                       Record all current findings in this file, then exit 0
  --changed            Report only findings in files that changed since the last run (hashes in .seaworthy/cache.json)
  --changed-since <ref>
                       Report only findings in files that differ from a git ref (for sites that commit their output)
`;

export function parseFiltering(options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number): number {
  switch (flag) {
    case "--config":
    case "--baseline":
    case "--update-baseline":
    case "--changed-since": {
      const [v, next] = value(flag, inline, args, index);
      if (flag === "--config") options.config = v;
      else if (flag === "--baseline") options.baseline = v;
      else if (flag === "--update-baseline") options.updateBaseline = v;
      else options.changedSince = v;
      return next;
    }
    default:
      options.changed = true;
      return index;
  }
}
