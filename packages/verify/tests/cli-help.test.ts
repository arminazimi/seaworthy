import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { run, EXIT } from "../src/cli.js";
import { OPTION_GROUPS } from "../src/cli/options/index.js";
import { makeSite } from "./helpers.js";

// The help pages are a byte-exact contract. The goldens pin every byte of them, so the
// cli/ module split (and any later refactor) cannot rewrap a line unnoticed. Regenerate
// the goldens from the built CLI only for an intentional help change:
//
//   node packages/verify/dist/src/cli.js --help > tests/golden/help.txt
//   node packages/verify/dist/src/cli.js config check --help > tests/golden/config-check-help.txt
//   node packages/verify/dist/src/cli.js init --help > tests/golden/init-help.txt
//   node packages/verify/dist/src/cli.js fix --help > tests/golden/fix-help.txt

// The compiled test runs from dist/tests, so the goldens are read from the source tree.
const golden = (name: string): string => readFileSync(fileURLToPath(new URL(`../../tests/golden/${name}`, import.meta.url)), "utf8");

const HELP_CASES: [string[], string][] = [
  [[], "help.txt"], // no arguments prints the same page as --help
  [["--help"], "help.txt"],
  [["-h"], "help.txt"],
  [["config"], "config-check-help.txt"], // config alone prints its subcommand's page
  [["config", "check", "--help"], "config-check-help.txt"],
  [["init", "--help"], "init-help.txt"],
  [["fix", "--help"], "fix-help.txt"],
];

test("every help page is byte-identical to its golden", async () => {
  for (const [argv, file] of HELP_CASES) {
    const result = await run(argv, { cwd: makeSite({}) });
    assert.equal(result.code, EXIT.ok, argv.join(" "));
    assert.equal(result.stdout, golden(file), `help page for ${JSON.stringify(argv)}`);
    assert.equal(result.stderr, "");
  }
});

test("every documented flag reaches the parser, and every parsed flag is documented", async () => {
  const page = golden("help.txt");
  const options = page.slice(page.indexOf("Options:\n"), page.indexOf("\ndiff:"));
  const documented = [...options.matchAll(/^ {2}(--[\w-]+)/gm)].map((m) => m[1] as string);
  const owned = OPTION_GROUPS.flatMap((group) => group.flags);

  // Both directions: a flag with help lines but no parser (or the reverse) is a split bug.
  for (const flag of owned) assert.ok(documented.includes(flag), `${flag} is parsed but not documented`);
  for (const flag of documented) assert.ok(owned.includes(flag) || flag === "--help" || flag === "--version", `${flag} is documented but parsed by no group`);

  // One flag, one owner: two groups claiming a flag would silently drop one parser.
  assert.deepEqual(owned.filter((flag, index) => owned.indexOf(flag) !== index), []);

  // Each flag is routed to some group: with a dummy value and an empty cwd, a known flag
  // fails later (folder, value validation), never with "unknown option".
  const cwd = makeSite({});
  for (const flag of owned) {
    const result = await run(["verify", flag, "dummy"], { cwd });
    assert.equal(result.code, EXIT.usage, flag);
    assert.doesNotMatch(result.stderr, /unknown option/, flag);
  }
});
