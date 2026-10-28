// `seaworthy init [dir] [--force]`: write the config, the CI workflow, and the empty baseline.
// The plan is pure (../init.ts); this layer only checks what exists, writes what the plan holds,
// and prints exactly which file it wrote or kept. Non-interactive: it never asks and never edits.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BASELINE_FILE, detectGenerator, INIT_MARKERS, INIT_MARKERS_HINT, planInit, WORKFLOW_FILE, type PlanOptions } from "../init.js";
import { CONFIG_FILE } from "../config.js";
import { EXIT, rootLabel, UsageError, type CliEnvironment, type CliResult } from "./types.js";

const INIT_HELP = `seaworthy init

Create the three files that adopt Seaworthy in one step, for people and agents. It detects the
site generator from marker file names only (Jekyll, Astro, Docusaurus, Hugo, or GitHub Pages)
and writes, without ever reading or editing your own files, without running any checks, and with
no writes outside the folder you name:

  seaworthy.config.json             built site folder and the baseline, per the config schema
  .github/workflows/seaworthy.yml   the generator's build step, then \`seaworthy verify\`
  seaworthy-baseline.json           an EMPTY first baseline: today's findings are accepted by
                                    recording them with --update-baseline (docs/configuration.md),
                                    while CI fails on every new one

The workflow is commented, and the config is plain JSON (JSON has no comments and the schema
rejects unknown keys), so the guidance a commented config would carry lives in the workflow and
in the docs page.

Usage:
  seaworthy init [dir]

Arguments:
  dir                  The project folder (the source, not the built site). Default: the current folder.

Options:
  --force              Overwrite seaworthy.config.json and seaworthy.yml with init's version. A second run
                       without it says "already present" and changes nothing. A baseline file that already
                       exists is never rewritten -- not even with --force -- because it records findings
                       you have accepted.
  --help, -h           Print this help

Exit codes:
  0  every file is present now (written, or kept and reported)
  2  usage error
`;

export async function initCommand(args: readonly string[], env: CliEnvironment): Promise<CliResult> {
  let dir: string | undefined;
  let force = false;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") return { code: EXIT.ok, stdout: INIT_HELP, stderr: "" };
    if (arg === "--force") {
      if (force) throw new UsageError("pass --force once");
      force = true;
      continue;
    }
    if (arg.startsWith("-")) throw new UsageError(`unknown option "${arg}"; seaworthy init takes only --force`);
    if (dir !== undefined) throw new UsageError(`unexpected argument "${arg}"; init takes one folder`);
    dir = arg;
  }

  const cwd = env.cwd ?? process.cwd();
  const base = resolve(cwd, dir ?? ".");
  if (!existsSync(base) || !statSync(base).isDirectory()) throw new UsageError(`${dir ?? "."} is not a folder`);
  const label = rootLabel(cwd, base);

  // Detection reads file names only: it never opens a user file, so an unparseable
  // generator config cannot crash init.
  const present = INIT_MARKERS.filter((name) => existsSync(resolve(base, name)));
  const detected = detectGenerator(present);
  const existing: PlanOptions["existing"] = {
    [CONFIG_FILE]: existsSync(resolve(base, CONFIG_FILE)),
    [WORKFLOW_FILE]: existsSync(resolve(base, WORKFLOW_FILE)),
    [BASELINE_FILE]: existsSync(resolve(base, BASELINE_FILE)),
  };

  const plan = planInit(detected, { existing, force });
  for (const write of plan.writes) {
    for (const folder of write.dirs) mkdirSync(resolve(base, folder), { recursive: true });
    writeFileSync(resolve(base, write.path), write.content);
  }

  const detection = detected === undefined ? `no generator detected; looked for ${INIT_MARKERS_HINT}` : `detected ${detected.name} from ${detected.marker}`;
  const fileWord = (n: number): string => (n === 1 ? "1 file" : `${n} files`);
  const wroteCount = plan.writes.length;
  const keptCount = plan.keeps.length;
  const lead =
    wroteCount === 0
      ? `seaworthy: init kept ${fileWord(keptCount)} already present in ${label} (${detection}); use --force to rewrite the files init owns`
      : keptCount === 0
        ? `seaworthy: init wrote ${fileWord(wroteCount)} in ${label} (${detection})`
        : `seaworthy: init wrote ${fileWord(wroteCount)}, kept ${fileWord(keptCount)} already present in ${label} (${detection})`;
  const lines = [
    lead,
    ...plan.writes.map((write) => `  wrote ${write.path} (${write.summary})`),
    ...plan.keeps.map((keep) => `  kept ${keep.path} (${keep.summary})`),
    `  next: ${plan.next}`,
  ];
  return { code: EXIT.ok, stdout: lines.join("\n") + "\n", stderr: "" };
}
