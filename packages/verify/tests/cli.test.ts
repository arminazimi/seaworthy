import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { EXIT, run } from "../src/cli.js";
import { REPORT_SPEC_VERSION, VERSION } from "../src/index.js";

test("--version prints the package version", () => {
  const result = run(["--version"]);
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stdout, `${VERSION}\n`);
});

test("no arguments prints help", () => {
  const result = run([]);
  assert.equal(result.code, EXIT.ok);
  assert.match(result.stdout, /Usage:/);
});

test("verify reports that it is not implemented yet", () => {
  const result = run(["verify", "."]);
  assert.equal(result.code, EXIT.notImplemented);
  assert.match(result.stderr, /E-verify/);
});

test("unknown commands exit with a usage error", () => {
  const result = run(["frobnicate"]);
  assert.equal(result.code, EXIT.usage);
  assert.match(result.stderr, /Unknown command: frobnicate/);
});

test("report spec version starts at 0 until the contract is frozen", () => {
  assert.equal(REPORT_SPEC_VERSION, 0);
});

test("the built binary runs as a process", () => {
  const bin = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const out = execFileSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
  assert.equal(out, `${VERSION}\n`);
});
