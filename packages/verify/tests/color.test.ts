import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { EXIT, run } from "../src/cli.js";
import { paletteFor, type ColorEnvironment, type Palette } from "../src/color.js";
import type { Check } from "../src/types.js";
import { makeSite } from "./helpers.js";

const PAGE = '<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body><a href="/missing.html">x</a></body></html>\n';
const escape = "\x1b[";
const reset = "\x1b[0m";

const problematic: Check = {
  meta: { id: "x.problem", title: "a problem", severity: "warning", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run: (ctx) => [...ctx.site.pages.values()].map((page) => ({ message: "a warning", location: { file: page.file, line: 3, column: 7 }, fix: { kind: "manual" as const, summary: "fix it" }, key: page.url })),
};
const crashing: Check = {
  meta: { id: "x.crash", title: "crashes", severity: "error", needs: ["html"], docs: "https://example.test/x", standards: [] },
  run() {
    throw new Error("boom");
  },
};

// The detection is injected, so these tests force each mode without depending on the test runner being a TTY.
const tty: ColorEnvironment = { stdoutIsTTY: true, stderrIsTTY: true, noColor: false };
const piped: ColorEnvironment = { stdoutIsTTY: false, stderrIsTTY: false, noColor: false };
const noColor: ColorEnvironment = { stdoutIsTTY: true, stderrIsTTY: true, noColor: true };

const painted = (palette: Palette): boolean => palette.error("x").startsWith(escape);

test("pretty output is painted only on a TTY", async () => {
  const argv = ["verify", makeSite({ "index.html": PAGE })];
  const colored = await run(argv, { checks: [problematic], color: tty });
  assert.equal(colored.code, EXIT.ok, "a warning does not fail by default");
  assert.ok(colored.stdout.includes(`${escape}33mwarning`), "the severity token is painted");
  assert.ok(colored.stdout.includes(`1 finding in 1 file: ${escape}33m1 warning${reset}.`), "the counts are painted");

  const plain = await run(argv, { checks: [problematic], color: piped });
  assert.doesNotMatch(plain.stdout, /\x1b\[/, "no escapes when stdout is not a terminal");
  assert.match(plain.stdout, /warning +x\.problem +a warning/, "the text reads the same, colored or not");
});

test("NO_COLOR keeps every byte plain even on a TTY", async () => {
  const pretty = await run(["verify", makeSite({ "index.html": PAGE })], { checks: [problematic, crashing], color: noColor });
  assert.doesNotMatch(pretty.stdout, /\x1b\[/);
  assert.doesNotMatch(pretty.stderr, /\x1b\[/);
  assert.match(pretty.stderr, /^seaworthy: 1 check crashed/);
});

test("json, markdown, and sarif are never painted, on a TTY or off", async () => {
  const site = makeSite({ "index.html": PAGE });
  for (const format of ["json", "markdown", "sarif"]) {
    const result = await run(["verify", site, "--format", format], { checks: [problematic], color: tty });
    assert.doesNotMatch(result.stdout, /\x1b\[/, format);
    if (format !== "markdown") JSON.parse(result.stdout); // machine formats stay parseable
  }
});

test("--out writes the report file plain even on a TTY; the summary line is painted", async () => {
  const cwd = makeSite({ "dist/index.html": PAGE });
  const result = await run(["verify", "dist", "--format", "json", "--out", "r.json"], { cwd, checks: [problematic], color: tty });
  const file = readFileSync(join(cwd, "r.json"), "utf8");
  assert.doesNotMatch(file, /\x1b\[/, "a report file is never colored");
  JSON.parse(file);
  assert.ok(result.stdout.includes(`1 finding (${escape}33m1 warning${reset})`), "the human summary line is painted");
});

test("crash notices are painted like errors on stderr, only on a TTY", async () => {
  const cwd = makeSite({ "index.html": PAGE });
  const forced = await run(["verify", cwd, "--update-baseline", "b.json"], { cwd, checks: [crashing], color: tty });
  assert.ok(forced.stderr.startsWith(`${escape}31mseaworthy: 1 check crashed${reset}`));

  const plain = await run(["verify", cwd, "--update-baseline", "b.json"], { cwd, checks: [crashing], color: piped });
  assert.equal(plain.stderr, "seaworthy: 1 check crashed; the baseline may be incomplete\n");
});

test("paletteFor paints per stream, keeps non-terminals plain, and NO_COLOR wins", () => {
  assert.equal(painted(paletteFor(undefined, "stdout")), false, "no environment means plain");
  assert.equal(painted(paletteFor(tty, "stdout")), true);
  assert.equal(painted(paletteFor(tty, "stderr")), true);
  assert.equal(painted(paletteFor({ stdoutIsTTY: false, stderrIsTTY: true, noColor: false }, "stdout")), false, "a piped stream stays plain");
  assert.equal(painted(paletteFor({ stdoutIsTTY: true, stderrIsTTY: false, noColor: false }, "stderr")), false, "stderr is asked about itself");
  assert.equal(painted(paletteFor(noColor, "stdout")), false, "NO_COLOR wins everywhere");
  assert.equal(painted(paletteFor(undefined, "stderr")), false, "no environment means plain");
});