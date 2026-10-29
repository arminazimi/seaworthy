// The verify option bag, composed from the groups in this folder. Each group module owns
// its flags end to end: the option fields, their defaults, the parser, and the help lines.
// Adding a flag means editing (or adding) one group module and, when it is a new group,
// registering it below; nothing else in the CLI changes.

import { type OutputOptions, OUTPUT_DEFAULTS, OUTPUT_FLAGS, OUTPUT_HELP, parseOutput } from "./output.js";
import { type FailOnOptions, FAIL_ON_DEFAULTS, FAIL_ON_FLAGS, FAIL_ON_HELP, parseFailOn } from "./fail-on.js";
import { type BaseOptions, BASE_DEFAULTS, BASE_FLAGS, BASE_HELP, parseBase } from "./base.js";
import { type MaxFindingsOptions, MAX_FINDINGS_DEFAULTS, MAX_FINDINGS_FLAGS, MAX_FINDINGS_HELP, parseMaxFindings } from "./max-findings.js";
import { type FilteringOptions, FILTERING_DEFAULTS, FILTERING_FLAGS, FILTERING_HELP, parseFiltering } from "./filtering.js";
import { type NewOnlyOptions, NEW_ONLY_DEFAULTS, NEW_ONLY_FLAGS, NEW_ONLY_HELP, parseNewOnly } from "./new-only.js";
import { type HistoryOptions, HISTORY_DEFAULTS, HISTORY_FLAGS, HISTORY_HELP, parseHistory } from "./history.js";
import { type WatchOptions, WATCH_DEFAULTS, WATCH_FLAGS, WATCH_HELP, parseWatch } from "./watch.js";
import { type SelectorOptions, SELECTOR_DEFAULTS, SELECTOR_FLAGS, SELECTOR_HELP, parseSelector } from "./selectors.js";
import { type TimingsOptions, TIMINGS_DEFAULTS, TIMINGS_FLAGS, TIMINGS_HELP, parseTimings } from "./timings.js";

export interface Options extends OutputOptions, FailOnOptions, BaseOptions, MaxFindingsOptions, FilteringOptions, NewOnlyOptions, HistoryOptions, WatchOptions, SelectorOptions, TimingsOptions {
  dir: string | undefined;
}

/** One option group: the flags it owns, its help lines, and its parser over the whole bag. */
export interface OptionGroup {
  /** The flags the group parses, in help order. */
  readonly flags: readonly string[];
  /** The help lines for the flags, each line ending with a newline. */
  readonly help: string;
  /** Parses one occurrence of one of the group's flags; returns the index of the last argument it consumed. */
  readonly parse: (options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number) => number;
}

/** Every group, in the order its flags appear in the root help. */
export const OPTION_GROUPS: readonly OptionGroup[] = [
  { flags: OUTPUT_FLAGS, help: OUTPUT_HELP, parse: parseOutput },
  { flags: FAIL_ON_FLAGS, help: FAIL_ON_HELP, parse: parseFailOn },
  { flags: BASE_FLAGS, help: BASE_HELP, parse: parseBase },
  { flags: MAX_FINDINGS_FLAGS, help: MAX_FINDINGS_HELP, parse: parseMaxFindings },
  { flags: FILTERING_FLAGS, help: FILTERING_HELP, parse: parseFiltering },
  { flags: NEW_ONLY_FLAGS, help: NEW_ONLY_HELP, parse: parseNewOnly },
  { flags: HISTORY_FLAGS, help: HISTORY_HELP, parse: parseHistory },
  { flags: WATCH_FLAGS, help: WATCH_HELP, parse: parseWatch },
  { flags: SELECTOR_FLAGS, help: SELECTOR_HELP, parse: parseSelector },
  { flags: TIMINGS_FLAGS, help: TIMINGS_HELP, parse: parseTimings },
];

/** Every option at its default, before any flag is parsed. */
export function defaultOptions(): Options {
  return {
    dir: undefined,
    ...OUTPUT_DEFAULTS,
    ...FAIL_ON_DEFAULTS,
    ...BASE_DEFAULTS,
    ...MAX_FINDINGS_DEFAULTS,
    ...FILTERING_DEFAULTS,
    ...NEW_ONLY_DEFAULTS,
    ...HISTORY_DEFAULTS,
    ...WATCH_DEFAULTS,
    ...SELECTOR_DEFAULTS,
    ...TIMINGS_DEFAULTS,
  };
}
