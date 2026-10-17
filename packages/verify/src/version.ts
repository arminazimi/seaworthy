import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export const VERSION: string = pkg.version;

/** Version of the report contract this build emits. 0 until `release.contract-freeze`; bumped only through an RFC. */
export const REPORT_SPEC_VERSION = 0;
