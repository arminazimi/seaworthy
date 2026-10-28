// The helper every value-taking flag shares: the value is either inline (`--flag=x`)
// or the next argument, which may never look like another flag.

import { UsageError } from "../types.js";

/** The value of a flag that takes one: inline after `=`, else the next argument, with the index it ends at. */
export function value(flag: string, inline: string | undefined, args: readonly string[], index: number): [string, number] {
  if (inline !== undefined) return [inline, index];
  const next = args[index + 1];
  if (next === undefined || next.startsWith("--")) throw new UsageError(`${flag} needs a value`);
  return [next, index + 1];
}
