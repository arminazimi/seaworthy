// --new-only: report only findings the previous run did not have. It reads the finding keys
// the last verify run stored in .seaworthy/history; findings that were already there are
// counted under the report's existing omitted counter, never silently dropped.

import type { Options } from "./index.js";

export interface NewOnlyOptions {
  /** Report only findings whose fingerprint is absent from the previous run's stored keys. */
  newOnly: boolean;
}

export const NEW_ONLY_DEFAULTS: NewOnlyOptions = { newOnly: false };

export const NEW_ONLY_FLAGS: readonly string[] = ["--new-only"];

export const NEW_ONLY_HELP = `  --new-only           Report only findings the previous run did not have, compared with
                        .seaworthy/history; findings that were there are counted as omitted.
                        Needs the run history (not with --no-history); without usable keys it
                        reports everything and says so.
`;

export function parseNewOnly(options: Options, _flag: string, _inline: string | undefined, _args: readonly string[], index: number): number {
  options.newOnly = true;
  return index;
}
