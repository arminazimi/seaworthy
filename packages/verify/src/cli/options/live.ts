// --fetch and --allow-private: verify pages that are already deployed, fetched into the same
// site graph a folder run builds. Off unless a URL is named, so the default run stays offline.

import { UsageError } from "../types.js";
import type { Options } from "./index.js";
import { value } from "./value.js";

export interface LiveOptions {
  /** Every `--fetch` address, in flag order. Empty: the built folder, as ever. */
  fetch: string[];
  /** Fetch private and link-local address literals too; loopback is allowed either way. */
  allowPrivate: boolean;
}

export const LIVE_DEFAULTS: LiveOptions = { fetch: [], allowPrivate: false };

export const LIVE_FLAGS: readonly string[] = ["--fetch", "--allow-private"];

export const LIVE_HELP = `  --fetch <url>        Verify a deployed page fetched over HTTP instead of a built folder. Repeat
                       the flag for more pages. Exactly the addresses named are fetched: nothing
                       is discovered from links or sitemaps here, robots.txt is not consulted, and
                       each page is reported under the path the fetch gives it in the snapshot.
  --allow-private      With --fetch: also allow private and link-local address literals, which are
                       refused by default so an address handed to an agent cannot name an internal
                       host. A loopback address you typed is always allowed.
`;

export function parseLive(options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number): number {
  if (flag === "--allow-private") {
    if (inline !== undefined) throw new UsageError("--allow-private is a flag and takes no value");
    options.allowPrivate = true;
    return index;
  }
  const [v, next] = value(flag, inline, args, index);
  // Reassigned, never pushed into: the shared LIVE_DEFAULTS array must stay pristine.
  options.fetch = [...options.fetch, v];
  return next;
}
