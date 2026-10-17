// Public entry point for @seaworthy/verify.
// The engine, check API, and report schema land in epic E-verify (Phase 1).

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export const VERSION: string = pkg.version;

/** Version of the report contract this build emits. Bumped only through an RFC. */
export const REPORT_SPEC_VERSION = 0;
