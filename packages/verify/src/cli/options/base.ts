// --base: the path the site is deployed under, overriding every other way the base path is decided.

import type { Options } from "./index.js";
import { value } from "./value.js";

export interface BaseOptions {
  base: string | undefined;
}

export const BASE_DEFAULTS: BaseOptions = { base: undefined };

export const BASE_FLAGS: readonly string[] = ["--base"];

export const BASE_HELP = `  --base <path>        The path the site is deployed under, such as /repo/. Overrides basePath
                        in seaworthy.config.json and base-path detection from generator configs.
`;

export function parseBase(options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number): number {
  const [v, next] = value(flag, inline, args, index);
  options.base = v;
  return next;
}
