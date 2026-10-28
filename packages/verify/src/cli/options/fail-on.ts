// --fail-on: which severity the exit code fails at.

import type { Severity } from "../../types.js";
import { UsageError } from "../types.js";
import type { Options } from "./index.js";
import { value } from "./value.js";

export interface FailOnOptions {
  failOn: Severity | "none" | undefined;
}

export const FAIL_ON_DEFAULTS: FailOnOptions = { failOn: undefined };

export const FAIL_ON_FLAGS: readonly string[] = ["--fail-on"];

export const FAIL_ON_HELP = `  --fail-on <level>    error (default), warning, note, or none. Exit 1 at or above this severity.
`;

export function parseFailOn(options: Options, flag: string, inline: string | undefined, args: readonly string[], index: number): number {
  const [v, next] = value(flag, inline, args, index);
  if (!["error", "warning", "note", "none"].includes(v)) throw new UsageError(`unknown --fail-on level "${v}"; use error, warning, note, or none`);
  options.failOn = v as FailOnOptions["failOn"];
  return next;
}
