// Package version reported to MCP clients in the initialize handshake (serverInfo.version).
// Mirrors packages/verify/src/version.ts: read the real version from this package's manifest
// instead of duplicating it in source.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const pkg = require("../../package.json") as { version: string };

export const SERVER_VERSION: string = pkg.version;
