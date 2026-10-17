#!/usr/bin/env node
// `seaworthy` command. Only --help and --version work today; `verify` is tracked in epic E-verify.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { VERSION } from "./version.js";

export const EXIT = {
  ok: 0,
  findings: 1,
  usage: 2,
  notImplemented: 3,
} as const;

const HELP = `seaworthy ${VERSION}

Verify any built static site for agents and humans.

Usage:
  seaworthy verify [dir]   Check a built site folder (not implemented yet)
  seaworthy --version      Print the version
  seaworthy --help         Print this help

Status: pre-alpha. See ROADMAP.md.
`;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(argv: readonly string[]): CliResult {
  const [command] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    return { code: EXIT.ok, stdout: HELP, stderr: "" };
  }
  if (command === "--version" || command === "-v") {
    return { code: EXIT.ok, stdout: `${VERSION}\n`, stderr: "" };
  }
  if (command === "verify") {
    return {
      code: EXIT.notImplemented,
      stdout: "",
      stderr: "seaworthy verify is not implemented yet. It is tracked in epic E-verify (Phase 1).\n",
    };
  }
  return { code: EXIT.usage, stdout: "", stderr: `Unknown command: ${command}\n\n${HELP}` };
}

// Run only when executed directly (including through the npm bin symlink), not when imported by tests.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
