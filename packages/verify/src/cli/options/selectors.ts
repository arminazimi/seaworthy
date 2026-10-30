// --rendered, --browser-path, --evidence, and --network: which checks run beyond the plain,
// offline default, which browser the rendered ones launch, and where they save the crops that
// prove their findings.

import type { Options } from "./index.js";
import { value } from "./value.js";

export interface SelectorOptions {
  rendered: boolean;
  browserPath: string | undefined;
  network: boolean;
  /** The folder --evidence writes crop images into, as the user gave it. Undefined: no evidence is saved. */
  evidence: string | undefined;
}

export const SELECTOR_DEFAULTS: SelectorOptions = { rendered: false, browserPath: undefined, network: false, evidence: undefined };

export const SELECTOR_FLAGS: readonly string[] = ["--rendered", "--browser-path", "--evidence", "--network"];

export const SELECTOR_HELP = `  --rendered           Run checks that need a browser
  --browser-path <path>
                       Browser executable for --rendered. Default: SEAWORTHY_BROWSER,
                       then an installed Chrome, Chromium, or Edge
  --evidence <folder>  Save a PNG crop of each rendered finding into Folder (a relative
                       folder outside the site; Seaworthy never writes in the folder it
                       verifies) and reference it from the report. Needs --rendered.
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
  if (flag === "--evidence") {
    options.evidence = v;
    return next;
  }
  options.browserPath = v;
  return next;
}
